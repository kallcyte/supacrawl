import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import { getInitialTheme, applyTheme, getInitialSansFont, applySansFont, getInitialMonoFont, applyMonoFont } from "./lib/theme"
import "./index.css"

// Apply theme + font settings before first paint to avoid a flash of the default theme.
applyTheme(getInitialTheme())
applySansFont(getInitialSansFont())
applyMonoFont(getInitialMonoFont())

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
