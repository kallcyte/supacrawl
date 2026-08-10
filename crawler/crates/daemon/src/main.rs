use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::Result;
use axum::{Router, routing::get};
use clap::Parser;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, Semaphore, broadcast};
use tracing::{error, info, info_span, Instrument};

use crawl_core::config::ConfigFile;
use crawl_core::robots::resolve_sitemap_urls;
use crawl_core::sitemap::fetch_and_parse_sitemap;
use crawl_core::types::{
    CheckResult, CrawlConfig, CrawlSummary, IpcMessage, KnownHash, StartCrawlRequest,
};
use crawl_checker::CheckContext;
use crawl_fetcher::FetchContext;
use crawl_notifier::types::{
    NotificationEvent, NotificationPayload, NotificationsConfig,
};
use crawl_notifier::Notifier;
use crawl_storage::Storage;

mod metrics;

#[derive(Parser)]
#[command(name = "crawl-daemon", about = "Supacrawl Rust crawler daemon")]
struct Cli {
    #[arg(short, long, default_value = "supacrawl.config.json")]
    config: PathBuf,

    #[arg(short, long, default_value = "./data/supacrawl.db")]
    db: PathBuf,

    #[arg(long)]
    sitemap: Vec<String>,

    #[arg(long)]
    json: bool,

    #[arg(long, default_value = "9090")]
    metrics_port: u16,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "crawl_daemon=info".into()),
        )
        .json()
        .init();

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let cli = Cli::parse();
    let dir = cli.db.parent().unwrap_or(Path::new("."));
    tokio::fs::create_dir_all(dir).await?;

    let metrics_handle = start_metrics_server(cli.metrics_port);

    let result = if cli.json {
        run_ipc_loop(&cli).await
    } else {
        run_one_off(&cli).await
    };

    let _ = metrics_handle.abort();
    result
}

fn start_metrics_server(port: u16) -> tokio::task::JoinHandle<()> {
    use metrics_exporter_prometheus::PrometheusBuilder;

    let handle = PrometheusBuilder::new()
        .install_recorder()
        .expect("failed to install Prometheus recorder");

    metrics::install_metrics();

    tokio::spawn(async move {
        let app = Router::new().route("/metrics", get(move || async move {
            handle.render()
        }));

        let addr = format!("0.0.0.0:{}", port);
        let listener = match tokio::net::TcpListener::bind(&addr).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!("Failed to bind metrics server on {}: {}", addr, e);
                return;
            }
        };

        info!("Metrics server listening on {}", addr);

        if let Err(e) = axum::serve(listener, app).await {
            tracing::warn!("Metrics server error: {}", e);
        }
    })
}

async fn run_one_off(cli: &Cli) -> Result<()> {
    let span = info_span!("crawl", crawl_id = %"one-off");
    let _guard = span.enter();

    metrics::crawl_started();

    let config: ConfigFile = if cli.config.exists() {
        crawl_core::config::load_config(&cli.config.to_string_lossy())?
    } else {
        ConfigFile {
            sitemaps: vec![],
            crawl: Some(CrawlConfig::default()),
            checks: None,
            schedule: None,
        }
    };

    let crawl_config = config.crawl.clone().unwrap_or_default();
    let checks_config = config.checks.clone().unwrap_or_default();
    let sitemap_urls = if !cli.sitemap.is_empty() {
        cli.sitemap.clone()
    } else {
        config.sitemap_urls()
    };

    if sitemap_urls.is_empty() {
        metrics::crawl_failed();
        return Err(anyhow::anyhow!(
            "No sitemaps provided. Use --sitemap <URL> or configure supacrawl.config.json"
        ));
    }

    let storage = Storage::open(&cli.db)?;
    let known_hashes = Arc::new(storage.load_known_hashes()?);

    let crawl_id = uuid::Uuid::new_v4().to_string();
    storage.create_crawl(&crawl_id)?;

    let mut entries = Vec::new();
    for sitemap_url_str in &sitemap_urls {
        let Ok(sitemap_url) = url::Url::parse(sitemap_url_str) else {
            metrics::sitemap_error();
            error!("Invalid sitemap URL: {}", sitemap_url_str);
            continue;
        };
        for resolved in resolve_sitemap_urls(&sitemap_url).await {
            match fetch_and_parse_sitemap(&resolved).await {
                Ok(e) => entries.extend(e),
                Err(e) => {
                    metrics::sitemap_error();
                    error!(sitemap = %resolved, error = %e, "Failed to parse sitemap");
                }
            }
        }
    }

    if entries.is_empty() {
        info!("No URLs found in sitemaps");
        metrics::crawl_completed();
        storage.fail_crawl(&crawl_id, "No URLs found")?;
        println!(
            "{}",
            serde_json::to_string_pretty(&CrawlSummary {
                crawl_id: crawl_id.clone(),
                total: 0,
                checked: 0,
                changed: 0,
                broken: 0,
                skipped: 0,
                ssl_expiring: vec![],
                mojibake_flagged: vec![],
                llm_garbage_flagged: vec![],
                broken_urls: vec![],
                changed_urls: vec![],
                health_score: 100.0,
            })?
        );
        return Ok(());
    }

    let urls_with_known: Vec<(url::Url, Option<String>, Option<KnownHash>)> = entries
        .iter()
        .filter_map(|entry| {
            let url = url::Url::parse(&entry.loc).ok()?;
            let known = known_hashes.iter().find(|h| h.url == entry.loc).cloned();
            Some((url, entry.lastmod.clone(), known))
        })
        .collect();

    let total = urls_with_known.len();
    info!(total, "Starting crawl");

    let fetcher = FetchContext::new(
        &crawl_config.user_agent,
        crawl_config.timeout_ms,
        crawl_config.max_body_bytes,
    )?;
    let checker = Arc::new(CheckContext::new(fetcher));
    let semaphore = Arc::new(Semaphore::new(crawl_config.max_global_concurrency));
    let delay_ms = crawl_config.delay_ms;

    let results: Arc<Mutex<Vec<CheckResult>>> = Arc::new(Mutex::new(Vec::new()));
    let mut handles = Vec::new();

    for (url, _lastmod, known) in urls_with_known {
        let _permit = semaphore.clone().acquire_owned().await?;
        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;

        let checker = checker.clone();
        let results_clone = results.clone();
        let span = info_span!("check_url", url = %url);

        let handle = tokio::spawn(
            async move {
                let _guard = span.enter();
                let start = tokio::time::Instant::now();
                let result = checker.check_url(&url, known.as_ref()).await;
                let elapsed = start.elapsed().as_millis() as u64;
                metrics::url_check_duration(elapsed);

                if let Some(sc) = result.status_code {
                    metrics::url_checked(sc);
                } else {
                    metrics::no_status_error();
                }

                if result.mojibake_flagged == Some(true) {
                    metrics::mojibake_detected();
                }
                if result.llm_garbage_flagged == Some(true) {
                    metrics::llm_garbage_detected();
                }
                if let Some(ref ssl) = result.ssl_info {
                    if ssl.days_remaining < 30 {
                        metrics::ssl_expiring();
                    }
                }

                results_clone.lock().await.push(result);
            }
            .in_current_span(),
        );

        handles.push(handle);
    }

    for handle in handles {
        let _ = handle.await;
    }

    let results = results.lock().await;
    let broken_urls: Vec<String> = results
        .iter()
        .filter(|r| r.status_code.map_or(true, |s| s >= 400))
        .map(|r| r.url.clone())
        .collect();
    let changed_urls: Vec<String> = results
        .iter()
        .filter(|r| r.content_changed == Some(true))
        .map(|r| r.url.clone())
        .collect();
    let broken = broken_urls.len();
    let changed = changed_urls.len();
    let checked = results.len();

    for result in results.iter() {
        let _ = storage.insert_result(&crawl_id, result);
        let _ = storage.upsert_url_state(result);
    }

    storage.complete_crawl(&crawl_id, changed, broken, 0, checked, total)?;

    metrics::crawl_completed();

    let ssl_expiring: Vec<String> = results
        .iter()
        .filter_map(|r| {
            r.ssl_info.as_ref().and_then(|s| {
                if s.days_remaining < checks_config.ssl.warn_days as i64 {
                    Some(r.url.clone())
                } else {
                    None
                }
            })
        })
        .collect();

    let mojibake_flagged: Vec<String> = results
        .iter()
        .filter_map(|r| {
            if r.mojibake_flagged == Some(true) {
                Some(r.url.clone())
            } else {
                None
            }
        })
        .collect();

    let llm_garbage_flagged: Vec<String> = results
        .iter()
        .filter_map(|r| {
            if r.llm_garbage_flagged == Some(true) {
                Some(r.url.clone())
            } else {
                None
            }
        })
        .collect();

    let summary = CrawlSummary {
        crawl_id: crawl_id.clone(),
        total,
        checked,
        changed,
        broken,
        skipped: 0,
        ssl_expiring: ssl_expiring.clone(),
        mojibake_flagged: mojibake_flagged.clone(),
        llm_garbage_flagged: llm_garbage_flagged.clone(),
        broken_urls: broken_urls.clone(),
        changed_urls: changed_urls.clone(),
        health_score: compute_health_score(checked, broken, &results),
    };

    let output = serde_json::to_string_pretty(&summary)?;
    println!("{}", output);

    Ok(())
}

async fn run_ipc_loop(cli: &Cli) -> Result<()> {
    let (shutdown_tx, _) = broadcast::channel::<()>(1);

    let stdin = tokio::io::stdin();
    let reader = BufReader::new(stdin);
    let mut lines = reader.lines();

    let mut stdout = tokio::io::stdout();

    let storage = Arc::new(Storage::open(&cli.db)?);

    tokio::spawn({
        let shutdown_tx = shutdown_tx.clone();
        async move {
            tokio::signal::ctrl_c().await.ok();
            info!("Received SIGTERM, shutting down");
            let _ = shutdown_tx.send(());
        }
    });

    while let Ok(Some(line)) = lines.next_line().await {
        eprintln!("IPC line bytes: {}", line.len());
        let request: StartCrawlRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let error_msg = serde_json::to_string(&IpcMessage::Error {
                    crawl_id: "unknown".to_string(),
                    error: format!("Invalid request: {}", e),
                })?;
                let _ = stdout.write_all(format!("{}\n", error_msg).as_bytes()).await;
                let _ = stdout.flush().await;
                continue;
            }
        };

        info!(crawl_id = %request.id, "IPC crawl request received");

        let storage = storage.clone();
        let mut shutdown_rx = shutdown_tx.subscribe();

        tokio::spawn(async move {
            if let Err(e) = run_ipc_crawl(request, storage, &mut shutdown_rx).await {
                error!(error = %e, "IPC crawl failed");
            }
        });
    }

    Ok(())
}

async fn run_ipc_crawl(
    request: StartCrawlRequest,
    storage: Arc<Storage>,
    _shutdown_rx: &mut broadcast::Receiver<()>,
) -> Result<()> {
    let crawl_id = request.id.clone();
    metrics::crawl_started();

    let span = info_span!("crawl", crawl_id = %crawl_id);
    let _guard = span.enter();

    info!("Starting IPC crawl");

    storage.create_crawl(&crawl_id)?;
    let known_hashes = storage.load_known_hashes()?;

    let mut entries = Vec::new();
    let mut sitemap_errors: Vec<String> = Vec::new();
    for sitemap_url_str in &request.sitemaps {
        let Ok(sitemap_url) = url::Url::parse(sitemap_url_str) else {
            sitemap_errors.push(format!("Invalid sitemap URL: {}", sitemap_url_str));
            continue;
        };
        for resolved in resolve_sitemap_urls(&sitemap_url).await {
            match fetch_and_parse_sitemap(&resolved).await {
                Ok(e) => entries.extend(e),
                Err(e) => {
                    metrics::sitemap_error();
                    sitemap_errors.push(format!("{}: {}", resolved, e));
                    error!(sitemap = %resolved, error = %e, "Failed to parse sitemap");
                }
            }
        }
    }

    let mut stdout = tokio::io::stdout();

    if entries.is_empty() && !sitemap_errors.is_empty() {
        let msg = format!("All sitemaps failed to fetch: {}", sitemap_errors.join("; "));
        storage.fail_crawl(&crawl_id, &msg)?;
        let error_msg = serde_json::to_string(&IpcMessage::Error {
            crawl_id: crawl_id.clone(),
            error: msg,
        })
        .unwrap_or_default();
        let _ = stdout.write_all(format!("{}\n", error_msg).as_bytes()).await;
        let _ = stdout.flush().await;
        return Ok(());
    }

    let urls: Vec<(url::Url, Option<String>)> = entries
        .iter()
        .filter_map(|e| url::Url::parse(&e.loc).ok().map(|u| (u, e.lastmod.clone())))
        .take(request.config.max_urls.unwrap_or(usize::MAX))
        .collect();

    let total = urls.len();
    info!(total, "Crawl starting");

    let progress = serde_json::to_string(&IpcMessage::Progress {
        crawl_id: crawl_id.clone(),
        checked: 0,
        total,
    })?;
    let _ = stdout.write_all(format!("{}\n", progress).as_bytes()).await;
    let _ = stdout.flush().await;

    let semaphore = Arc::new(Semaphore::new(request.config.max_global_concurrency));
    let delay_ms = request.config.delay_ms;
    let bounded_queue: Arc<
        Mutex<std::collections::VecDeque<(url::Url, Option<String>, Option<KnownHash>)>>,
    > = Arc::new(Mutex::new(std::collections::VecDeque::new()));

    let result_buffer: Arc<Mutex<Vec<CheckResult>>> = Arc::new(Mutex::new(Vec::new()));
    let progress_counter = Arc::new(AtomicUsize::new(0));
    const _MAX_BUFFER: usize = 100;

    for (url, lastmod) in &urls {
        let known = known_hashes
            .iter()
            .find(|h| h.url == url.to_string())
            .cloned();
        bounded_queue
            .lock()
            .await
            .push_back((url.clone(), lastmod.clone(), known));
    }

    let fetcher = FetchContext::new(
        &request.config.user_agent,
        request.config.timeout_ms,
        request.config.max_body_bytes,
    )?;
    let checker = Arc::new(CheckContext::new(fetcher));

    let notifier = Notifier::new(&NotificationsConfig::default());
    let mut _checked = 0usize;
    let mut handles = Vec::new();

    loop {
        let item = {
            let mut queue = bounded_queue.lock().await;
            queue.pop_front()
        };

        match item {
            Some((url, _lastmod, known)) => {
                let queue_depth = bounded_queue.lock().await.len();
                if queue_depth > 5000 {
                    let bp = serde_json::to_string(&IpcMessage::Backpressure {
                        crawl_id: crawl_id.clone(),
                        queue_depth,
                        paused: true,
                    })
                    .unwrap_or_default();
                    let _ = stdout.write_all(format!("{}\n", bp).as_bytes()).await;
                    let _ = stdout.flush().await;
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }

                let _permit = semaphore.clone().acquire_owned().await?;
                tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;

                let checker = checker.clone();
                let result_buffer = result_buffer.clone();
                let progress_counter = progress_counter.clone();
                let _storage = storage.clone();
                let _id = crawl_id.clone();

                let handle = tokio::spawn(
                    async move {
                        let start = tokio::time::Instant::now();
                        let result = checker.check_url(&url, known.as_ref()).await;
                        let elapsed = start.elapsed().as_millis() as u64;
                        metrics::url_check_duration(elapsed);

                        if let Some(sc) = result.status_code {
                            metrics::url_checked(sc);
                        }

                        if result.mojibake_flagged == Some(true) {
                            metrics::mojibake_detected();
                        }
                        if result.llm_garbage_flagged == Some(true) {
                            metrics::llm_garbage_detected();
                        }

                        let mut buffer = result_buffer.lock().await;
                        buffer.push(result);

                        let done = progress_counter.fetch_add(1, Ordering::Relaxed) + 1;
                        if done % 25 == 0 {
                            let msg = serde_json::to_string(&IpcMessage::Progress {
                                crawl_id: _id.clone(),
                                checked: done,
                                total,
                            })
                            .unwrap_or_default();
                            let mut stdout = tokio::io::stdout();
                            let _ = stdout.write_all(format!("{}\n", msg).as_bytes()).await;
                            let _ = stdout.flush().await;
                        }
                    }
                    .in_current_span(),
                );

                handles.push(handle);
                _checked += 1;
            }
            None => break,
        }
    }

    for handle in handles.drain(..) {
        let _ = handle.await;
    }

    let mut buffer = result_buffer.lock().await;
    for r in buffer.drain(..) {
        let msg = serde_json::to_string(&IpcMessage::Result {
            crawl_id: crawl_id.clone(),
            result: r.clone(),
        })
        .unwrap_or_default();
        let _ = stdout.write_all(format!("{}\n", msg).as_bytes()).await;
        let _ = stdout.flush().await;
        let _ = storage.insert_result(&crawl_id, &r);
        let _ = storage.upsert_url_state(&r);
    }
    drop(buffer);

    let results = storage.load_latest_results_for_crawl(&crawl_id)?;

    let final_progress = serde_json::to_string(&IpcMessage::Progress {
        crawl_id: crawl_id.clone(),
        checked: results.len(),
        total,
    })?;
    let _ = stdout.write_all(format!("{}\n", final_progress).as_bytes()).await;
    let _ = stdout.flush().await;

    let broken_urls: Vec<String> = results
        .iter()
        .filter(|r| r.status_code.map_or(true, |s| s >= 400))
        .map(|r| r.url.clone())
        .collect();
    let changed_urls: Vec<String> = results
        .iter()
        .filter(|r| r.content_changed == Some(true))
        .map(|r| r.url.clone())
        .collect();
    let broken = broken_urls.len();
    let changed = changed_urls.len();

    storage.complete_crawl(&crawl_id, changed, broken, 0, results.len(), total)?;
    metrics::crawl_completed();

    let ssl_expiring: Vec<String> = results
        .iter()
        .filter_map(|r| {
            r.ssl_info.as_ref().and_then(|s| {
                if s.days_remaining < request.checks.ssl.warn_days as i64 {
                    Some(r.url.clone())
                } else {
                    None
                }
            })
        })
        .collect();

    let mojibake_flagged: Vec<String> = results
        .iter()
        .filter_map(|r| {
            if r.mojibake_flagged == Some(true) {
                Some(r.url.clone())
            } else {
                None
            }
        })
        .collect();

    let llm_garbage_flagged: Vec<String> = results
        .iter()
        .filter_map(|r| {
            if r.llm_garbage_flagged == Some(true) {
                Some(r.url.clone())
            } else {
                None
            }
        })
        .collect();

    let summary = CrawlSummary {
        crawl_id: crawl_id.clone(),
        total,
        checked: results.len(),
        changed,
        broken,
        skipped: 0,
        ssl_expiring: ssl_expiring.clone(),
        mojibake_flagged: mojibake_flagged.clone(),
        llm_garbage_flagged: llm_garbage_flagged.clone(),
        broken_urls: broken_urls.clone(),
        changed_urls: changed_urls.clone(),
        health_score: compute_health_score(results.len(), broken, &results),
    };

    let complete = serde_json::to_string(&IpcMessage::Complete {
        crawl_id: crawl_id.clone(),
        record: summary.clone(),
    })?;
    let _ = stdout.write_all(format!("{}\n", complete).as_bytes()).await;
    let _ = stdout.flush().await;

    let payload = NotificationPayload::from_crawl_summary(
        NotificationEvent::OnCrawlComplete,
        "Crawl Complete",
        &summary,
    );
    notifier.notify(&payload).await;

    if broken > 0 {
        let payload = NotificationPayload::from_crawl_summary(
            NotificationEvent::OnCrawlFailure,
            &format!("Crawl Failed — {} broken", broken),
            &summary,
        );
        notifier.notify(&payload).await;
    }

    info!(health = summary.health_score, "Crawl complete");
    metrics::crawl_completed();

    Ok(())
}

fn compute_health_score(checked: usize, broken: usize, results: &[CheckResult]) -> f64 {
    if checked == 0 {
        return 100.0;
    }

    let mojibake = results
        .iter()
        .filter(|r| r.mojibake_flagged == Some(true))
        .count();
    let llm = results
        .iter()
        .filter(|r| r.llm_garbage_flagged == Some(true))
        .count();

    let penalty = (broken as f64) * 1.0 + (mojibake as f64) * 0.5 + (llm as f64) * 0.5;
    (100.0 - penalty * 100.0 / checked as f64).max(0.0)
}
