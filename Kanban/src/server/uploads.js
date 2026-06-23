import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import Busboy from "busboy";
import { httpError } from "./store.js";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SAFE_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".txt",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".zip"
]);

export function saveUploadedFile(req, { uploadDir, publicPath = "/uploads" }) {
  return new Promise((resolve, reject) => {
    mkdirSync(uploadDir, { recursive: true });
    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_FILE_SIZE
      }
    });
    let savedFile = null;
    let pendingWrite = null;
    let rejected = false;

    function fail(error) {
      if (rejected) return;
      rejected = true;
      if (savedFile?.path) rmSync(savedFile.path, { force: true });
      reject(error);
    }

    busboy.on("file", (_fieldName, file, info) => {
      const originalName = String(info.filename || "file").trim() || "file";
      const ext = normalizeExtension(originalName);
      const storedName = `${Date.now()}-${randomBytes(8).toString("hex")}${ext}`;
      const filePath = join(uploadDir, storedName);
      const stream = createWriteStream(filePath);
      let size = 0;

      file.on("data", (chunk) => {
        size += chunk.length;
      });
      file.on("limit", () => {
        fail(httpError(413, "Файл больше 10 МБ"));
      });
      file.on("error", fail);
      stream.on("error", fail);
      pendingWrite = new Promise((streamResolve, streamReject) => {
        stream.on("finish", streamResolve);
        stream.on("error", streamReject);
      });

      file.pipe(stream);
      savedFile = {
        name: originalName,
        url: `${publicPath}/${storedName}`,
        fileName: originalName,
        size,
        mimeType: String(info.mimeType || "application/octet-stream"),
        path: filePath
      };
      stream.on("finish", () => {
        savedFile.size = size;
      });
    });

    busboy.on("error", fail);
    busboy.on("finish", async () => {
      if (rejected) return;
      try {
        if (!savedFile) throw httpError(400, "Файл не передан");
        if (pendingWrite) await pendingWrite;
        const { path: _path, ...publicFile } = savedFile;
        resolve(publicFile);
      } catch (error) {
        fail(error);
      }
    });

    req.pipe(busboy);
  });
}

function normalizeExtension(filename) {
  const ext = extname(filename).toLowerCase();
  if (!ext) return ".bin";
  return SAFE_EXTENSIONS.has(ext) ? ext : ".bin";
}
