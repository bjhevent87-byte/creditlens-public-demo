import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set([".pdf", ".docx", ".xlsx", ".csv", ".png", ".jpg", ".jpeg"]);

export class CaseRepository {
  constructor(root) { this.root = root; }

  folder(id) {
    if (!ID.test(id)) throw new Error("잘못된 사건 식별자입니다.");
    return path.join(this.root, id);
  }

  async load(id) {
    try { return JSON.parse(await readFile(path.join(this.folder(id), "latest.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async list() {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const items = await Promise.all(entries.filter((entry) => entry.isDirectory() && ID.test(entry.name)).map((entry) => this.load(entry.name)));
    return items.filter(Boolean).map(({ id, revision, updatedAt, companyName, corpCode, summary }) => ({ id, revision, updatedAt, companyName, corpCode, summary })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(input) {
    const id = input.id || randomUUID();
    const folder = this.folder(id);
    const previous = await this.load(id);
    const revision = (previous?.revision || 0) + 1;
    const updatedAt = new Date().toISOString();
    const record = {
      id, revision, createdAt: previous?.createdAt || updatedAt, updatedAt,
      companyName: String(input.companyName || "").slice(0, 100),
      corpCode: String(input.corpCode || "").slice(0, 12),
      summary: String(input.summary || "").slice(0, 250),
      snapshot: input.snapshot || {},
    };
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `rev-${String(revision).padStart(4, "0")}.json`), JSON.stringify(record, null, 2), { flag: "wx" });
    await writeFile(path.join(folder, "latest.json"), JSON.stringify(record, null, 2));
    return { id, revision, updatedAt, companyName: record.companyName };
  }

  async revisions(id) {
    const files = (await readdir(this.folder(id))).filter((name) => /^rev-\d{4}\.json$/.test(name));
    return Promise.all(files.sort().map(async (name) => {
      const { revision, updatedAt, summary, snapshot } = JSON.parse(await readFile(path.join(this.folder(id), name), "utf8"));
      return { revision, updatedAt, summary, decisions: snapshot?.reviewOutcome || null };
    }));
  }

  async addEvidence(id, input) {
    const current = await this.load(id);
    if (!current) throw new Error("먼저 사건을 저장해 주세요.");
    const inspectionId = String(input.inspectionId || "").slice(0, 80);
    if (inspectionId && !/^FI-[A-Za-z0-9-]{1,77}$/.test(inspectionId)) throw new Error("올바른 현장실사 항목 식별자가 아닙니다.");
    const originalName = String(input.name || "").slice(0, 150);
    const extension = path.extname(originalName).toLowerCase();
    if (!ALLOWED.has(extension)) throw new Error("PDF·Word·Excel·CSV·이미지 파일만 등록할 수 있습니다.");
    const base64 = String(input.base64 || "");
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error("첨부파일 인코딩이 올바르지 않습니다.");
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 10_000_000) throw new Error("첨부파일은 10MB 이하만 등록할 수 있습니다.");
    if (extension === ".pdf" && bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("올바른 PDF 파일이 아닙니다.");
    if (extension === ".png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("올바른 PNG 파일이 아닙니다.");
    if ([".jpg", ".jpeg"].includes(extension) && !bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) throw new Error("올바른 JPG 파일이 아닙니다.");
    const fileId = randomUUID();
    const folder = path.join(this.folder(id), "evidence");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, `${fileId}${extension}`), bytes, { flag: "wx" });
    return { id: fileId, name: originalName, extension, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), uploadedAt: new Date().toISOString(), findingId: String(input.findingId || "").slice(0, 80), inspectionId, status: "검증 전 첨부" };
  }

  async evidenceFile(id, fileId) {
    if (!ID.test(fileId)) throw new Error("잘못된 첨부파일 식별자입니다.");
    const folder = path.join(this.folder(id), "evidence");
    const name = (await readdir(folder)).find((entry) => entry.startsWith(`${fileId}.`) && ALLOWED.has(path.extname(entry).toLowerCase()));
    if (!name) throw new Error("첨부파일을 찾지 못했습니다.");
    return { bytes: await readFile(path.join(folder, name)), extension: path.extname(name).toLowerCase() };
  }
}
