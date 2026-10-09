// meta-skill 후보 목록
// 사용
//   node registry.mjs collect          목록을 새로 모아 이 폴더의 registry.json에 저장한다
//   node registry.mjs search 말 ...     registry.json에서 찾는다. 영어와 한국어 말을 함께 준다
// 저장 파일은 이 스크립트와 같은 폴더의 registry.json 하나뿐이다.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const registryPath = join(here, "registry.json")
const [command, ...words] = process.argv.slice(2)

async function getText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "meta-skill" } })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}

function frontmatter(text) {
  const head = text.startsWith("---") ? text.split("---")[1] || "" : ""
  const field = (key) => {
    const match = head.match(new RegExp(`^${key}:\s*(.*)$`, "m"))
    return match ? match[1].trim().replace(/^["'|>]\s*|["']$/g, "") : ""
  }
  return { name: field("name"), description: field("description") }
}

async function fromAnthropicSkills() {
  const list = JSON.parse(await getText("https://api.github.com/repos/anthropics/skills/contents/skills"))
  const items = []
  for (const dir of list.filter((x) => x.type === "dir")) {
    const raw = `https://raw.githubusercontent.com/anthropics/skills/main/skills/${dir.name}/SKILL.md`
    try {
      const { name, description } = frontmatter(await getText(raw))
      items.push({ name: name || dir.name, description, source: "anthropics/skills", url: raw })
    } catch {}
  }
  return items
}

async function fromOfficialPlugins() {
  const market = JSON.parse(
    await getText("https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json"),
  )
  return market.plugins.map((p) => {
    const src = p.source
    const url =
      typeof src === "object" && src.url
        ? src.url.replace(/\.git$/, "") + (src.path ? `/tree/${src.ref || "main"}/${src.path}` : "")
        : p.homepage || `https://github.com/anthropics/claude-plugins-official/tree/main/${String(src).replace("./", "")}`
    return { name: p.name, description: p.description || "", source: "official-plugin", url }
  })
}

async function fromAwesomeList() {
  const readme = await getText("https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md")
  const items = []
  for (const line of readme.split("\n")) {
    const match = line.match(/^\s*- \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)(?: by .*?)? - (.*)$/)
    if (match) items.push({ name: match[1], description: match[3].trim(), source: "awesome-claude-code", url: match[2] })
  }
  return items
}

function fromThisComputer() {
  const items = []
  const roots = [join(homedir(), ".claude", "skills"), join(homedir(), ".claude", "plugins")]
  const walk = (dir, depth) => {
    if (depth > 8) return
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name === "node_modules" || name.startsWith(".")) continue
      const path = join(dir, name)
      let info
      try {
        info = statSync(path)
      } catch {
        continue
      }
      if (info.isDirectory()) walk(path, depth + 1)
      else if (name === "SKILL.md") {
        const { name: skill, description } = frontmatter(readFileSync(path, "utf8"))
        if (skill && !skill.startsWith("meta-")) items.push({ name: skill, description, source: "this-computer", url: path })
      }
    }
  }
  roots.forEach((root) => walk(root, 0))
  return items
}

async function collect() {
  const sources = [
    ["anthropics/skills", fromAnthropicSkills],
    ["official-plugin", fromOfficialPlugins],
    ["awesome-claude-code", fromAwesomeList],
    ["this-computer", fromThisComputer],
  ]
  const all = []
  for (const [label, run] of sources) {
    try {
      const items = await run()
      all.push(...items)
      console.log(`${label}: ${items.length}`)
    } catch (error) {
      console.log(`${label}: 실패 (${error.message})`)
    }
  }
  const seen = new Set()
  const unique = all.filter((item) => {
    const key = item.source + "|" + item.name + "|" + item.description
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  writeFileSync(registryPath, JSON.stringify({ collected: new Date().toISOString(), items: unique }, null, 2))
  console.log(`저장: ${registryPath} (${unique.length}개)`)
}

function search() {
  if (!existsSync(registryPath)) {
    console.log("registry.json이 없습니다. node registry.mjs collect를 먼저 실행하세요.")
    process.exit(1)
  }
  const { collected, items } = JSON.parse(readFileSync(registryPath, "utf8"))
  const terms = words.map((w) => w.toLowerCase())
  const scored = items
    .map((item) => {
      const name = item.name.toLowerCase()
      const text = (item.name + " " + item.description).toLowerCase()
      const score = terms.reduce((sum, t) => sum + (name.includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0), 0)
      return { ...item, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
  console.log(`모은 날: ${collected}`)
  for (const item of scored) console.log(JSON.stringify({ score: item.score, ...item, description: item.description.slice(0, 220) }))
}

if (command === "collect") await collect()
else if (command === "search") search()
else console.log("사용: node registry.mjs collect | search 말 ...")
