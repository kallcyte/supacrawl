// Validate the test xlsx file
import JSZip from "jszip/lib/index.js"
import fs from "node:fs"

const buf = fs.readFileSync(process.env.TEMP + "/test.xlsx")
const zip = await JSZip.loadAsync(buf)

console.log("Files in xlsx:")
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue
  console.log(" -", name, `(${entry._data?.uncompressedSize ?? "?"} bytes)`)
}

// Try to parse content types
const ct = await zip.file("[Content_Types].xml")?.async("string")
console.log("\n[Content_Types].xml:")
console.log(ct)

// Try to parse the first sheet
const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string")
console.log("\nsheet1.xml preview (first 500 chars):")
console.log(sheet?.slice(0, 500))