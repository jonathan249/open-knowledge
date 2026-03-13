import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type PdfTextItem = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

type PositionedFragment = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
};

type PdfTextLine = {
  text: string;
  y: number;
  minX: number;
  maxX: number;
  fragmentCount: number;
};

type PdfPageText = {
  pageNumber: number;
  pageHeight: number;
  lines: PdfTextLine[];
};

export type PdfConversionResult = {
  content: string;
  pageCount: number;
  extractionWarnings?: string[];
};

type PdfJsWorkerModule = {
  WorkerMessageHandler: unknown;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

const LOCAL_OCR_DPI = 300;
const DEFAULT_OCR_LANGUAGE = "eng";
const DEFAULT_OCR_PSM = "6";

function runCommand(command: string, args: string[]) {
  return new Promise<CommandResult>((resolve, reject) => {
    const childProcess = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout.setEncoding("utf8");
    childProcess.stderr.setEncoding("utf8");
    childProcess.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    childProcess.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    childProcess.on("error", reject);
    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`,
        ),
      );
    });
  });
}

function extractPageNumberFromImageName(fileName: string) {
  const match = fileName.match(/-(\d+)\.png$/);
  if (!match?.[1]) {
    return null;
  }

  const parsedPageNumber = Number.parseInt(match[1], 10);
  if (Number.isNaN(parsedPageNumber) || parsedPageNumber <= 0) {
    return null;
  }

  return parsedPageNumber;
}

function normalizeOcrPageText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === expectedCode
  );
}

async function extractPagesWithLocalOcr(
  pdfData: Uint8Array,
  pageNumbers: number[],
) {
  if (pageNumbers.length === 0) {
    return new Map<number, string>();
  }

  const ocrLanguage =
    process.env.PDF_OCR_LANG?.trim() || DEFAULT_OCR_LANGUAGE;
  const ocrPageSegmentationMode =
    process.env.PDF_OCR_PSM?.trim() || DEFAULT_OCR_PSM;
  const pageNumberSet = new Set(pageNumbers);
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), "open-knowledge-ocr-"),
  );
  const inputPdfPath = path.join(workingDirectory, "input.pdf");
  const outputPrefix = path.join(workingDirectory, "ocr-page");

  try {
    await writeFile(inputPdfPath, pdfData);

    await runCommand("pdftoppm", [
      "-r",
      String(LOCAL_OCR_DPI),
      "-png",
      inputPdfPath,
      outputPrefix,
    ]);

    const generatedFiles = await readdir(workingDirectory);
    const imageFiles = generatedFiles
      .filter(
        (fileName) =>
          fileName.startsWith("ocr-page-") && fileName.endsWith(".png"),
      )
      .sort((left, right) => {
        const leftPageNumber = extractPageNumberFromImageName(left) ?? 0;
        const rightPageNumber = extractPageNumberFromImageName(right) ?? 0;
        return leftPageNumber - rightPageNumber;
      });

    const ocrPages = new Map<number, string>();

    for (const imageFile of imageFiles) {
      const pageNumber = extractPageNumberFromImageName(imageFile);
      if (!pageNumber || !pageNumberSet.has(pageNumber)) {
        continue;
      }

      const imagePath = path.join(workingDirectory, imageFile);
      const { stdout } = await runCommand("tesseract", [
        imagePath,
        "stdout",
        "-l",
        ocrLanguage,
        "--psm",
        ocrPageSegmentationMode,
        "--oem",
        "1",
        "-c",
        "preserve_interword_spaces=1",
      ]);
      const normalizedOcrText = normalizeOcrPageText(stdout);

      if (normalizedOcrText.length > 0) {
        ocrPages.set(pageNumber, `## Page ${pageNumber}\n${normalizedOcrText}`);
      }
    }

    return ocrPages;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new Error(
        "Local OCR requires both `pdftoppm` (Poppler) and `tesseract` installed on this machine. Install them and retry.",
      );
    }

    if (error instanceof Error) {
      throw new Error(`Local OCR failed: ${error.message}`);
    }

    throw new Error("Local OCR failed.");
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof item.str === "string" &&
    "transform" in item &&
    Array.isArray(item.transform)
  );
}

function normalizeInlineText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  return sortedValues[middle];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function joinInlineFragments(fragments: PositionedFragment[]) {
  if (fragments.length === 0) {
    return "";
  }

  const sortedFragments = [...fragments].sort((left, right) => left.x - right.x);
  const separatorThreshold = 24;
  const tokenFragments: string[] = [sortedFragments[0]?.text ?? ""];
  let previousRightEdge =
    (sortedFragments[0]?.x ?? 0) + (sortedFragments[0]?.width ?? 0);

  for (let index = 1; index < sortedFragments.length; index += 1) {
    const fragment = sortedFragments[index];
    if (!fragment) {
      continue;
    }

    const gap = fragment.x - previousRightEdge;
    const separator =
      gap > separatorThreshold && sortedFragments.length >= 3 ? " | " : " ";

    tokenFragments.push(separator, fragment.text);
    previousRightEdge = fragment.x + fragment.width;
  }

  return tokenFragments
    .join("")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function groupTextIntoLines(items: unknown[]) {
  const positionedItems = items
    .filter(isPdfTextItem)
    .map((item) => ({
      text: normalizeInlineText(item.str),
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      width: typeof item.width === "number" ? item.width : 0,
      height:
        typeof item.height === "number" && item.height > 0 ? item.height : 0,
      hasEOL: item.hasEOL ?? false,
    }))
    .filter((item) => item.text.length > 0)
    .sort((left, right) => right.y - left.y || left.x - right.x);

  if (positionedItems.length === 0) {
    return [];
  }

  const estimatedFontHeight = median(
    positionedItems.map((item) => item.height).filter((height) => height > 0),
  );
  const yMergeTolerance = clamp(estimatedFontHeight * 0.45, 1.8, 4.5);
  const lines: Array<{ y: number; fragments: PositionedFragment[] }> = [];

  for (const item of positionedItems) {
    const existingLine = lines.find(
      (line) => Math.abs(line.y - item.y) <= yMergeTolerance,
    );

    if (existingLine) {
      existingLine.fragments.push(item);
      continue;
    }

    lines.push({
      y: item.y,
      fragments: [item],
    });
  }

  return lines
    .sort((left, right) => right.y - left.y)
    .map(
      (line): PdfTextLine => ({
        y: line.y,
        text: joinInlineFragments(line.fragments),
        minX: Math.min(...line.fragments.map((fragment) => fragment.x)),
        maxX: Math.max(
          ...line.fragments.map((fragment) => fragment.x + fragment.width),
        ),
        fragmentCount: line.fragments.length,
      }),
    )
    .filter((line) => line.text.length > 0);
}

function normalizeBoilerplateKey(text: string) {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}# ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEdgeLine(line: PdfTextLine, pageHeight: number) {
  return line.y >= pageHeight * 0.88 || line.y <= pageHeight * 0.12;
}

function detectRepeatedEdgeKeys(pages: PdfPageText[]) {
  const keyCounts = new Map<string, number>();

  for (const page of pages) {
    const pageKeys = new Set<string>();
    const topCandidates = page.lines
      .filter((line) => line.y >= page.pageHeight * 0.88)
      .slice(0, 3);
    const bottomCandidates = page.lines
      .filter((line) => line.y <= page.pageHeight * 0.12)
      .slice(-3);

    for (const line of [...topCandidates, ...bottomCandidates]) {
      const key = normalizeBoilerplateKey(line.text);
      if (key.length < 4) {
        continue;
      }
      pageKeys.add(key);
    }

    for (const key of pageKeys) {
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
  }

  const requiredMatches = Math.max(2, Math.ceil(pages.length * 0.45));

  return new Set(
    [...keyCounts.entries()]
      .filter(([, count]) => count >= requiredMatches)
      .map(([key]) => key),
  );
}

function normalizeListLine(text: string) {
  const bulletNormalized = text.replace(/^[•◦▪●·]\s+/u, "- ");
  return bulletNormalized.replace(/^(\d+)[)\]]\s+/, "$1. ");
}

function formatTableLine(text: string) {
  const cells = text
    .split(/\s\|\s/)
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

  if (cells.length < 2) {
    return text;
  }

  return `| ${cells.join(" | ")} |`;
}

function linesToMarkdown(page: PdfPageText, repeatedEdgeKeys: Set<string>) {
  const filteredLines = page.lines.filter((line) => {
    if (!isEdgeLine(line, page.pageHeight)) {
      return true;
    }
    const key = normalizeBoilerplateKey(line.text);
    return !repeatedEdgeKeys.has(key);
  });

  if (filteredLines.length === 0) {
    return "";
  }

  const body: string[] = [`## Page ${page.pageNumber}`];
  let previousY = filteredLines[0]?.y ?? 0;
  const lineGaps = filteredLines
    .slice(1)
    .map((line, index) =>
      Math.abs((filteredLines[index]?.y ?? line.y) - line.y),
    )
    .filter((gap) => gap > 0);
  const medianGap = median(lineGaps);
  const paragraphGapThreshold = Math.max(medianGap * 1.7, 14);
  let previousLineWasTable = false;

  for (const line of filteredLines) {
    const verticalGap = Math.abs(previousY - line.y);

    if (body.length > 1 && verticalGap > paragraphGapThreshold) {
      body.push("");
    }

    const normalizedLine = normalizeListLine(line.text);
    const isTableLine =
      line.fragmentCount >= 3 &&
      normalizedLine.includes(" | ") &&
      line.maxX - line.minX > 120;
    const markdownLine = isTableLine
      ? formatTableLine(normalizedLine)
      : normalizedLine;

    if (isTableLine && !previousLineWasTable && body.length > 1) {
      body.push("");
    }

    if (!isTableLine && previousLineWasTable) {
      body.push("");
    }

    body.push(markdownLine);
    previousLineWasTable = isTableLine;
    previousY = line.y;
  }

  return body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function humanizePdfError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Could not read this PDF.";
  }

  if (/password|encrypted/i.test(error.message)) {
    return "This PDF is encrypted or password protected and cannot be indexed yet.";
  }

  if (/Invalid PDF|missing PDF/i.test(error.message)) {
    return "This file does not look like a valid PDF.";
  }

  return error.message || "Could not read this PDF.";
}

export async function convertPdfToMarkdown(
  data: ArrayBuffer | Uint8Array,
): Promise<PdfConversionResult> {
  const [pdfjs, pdfjsWorker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  const pdfData = data instanceof Uint8Array ? data : new Uint8Array(data);
  const globalWithPdfWorker = globalThis as typeof globalThis & {
    pdfjsWorker?: PdfJsWorkerModule;
  };

  globalWithPdfWorker.pdfjsWorker ??= pdfjsWorker as PdfJsWorkerModule;

  const loadingTask = pdfjs.getDocument({
    data: pdfData,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const pages: PdfPageText[] = [];
    const extractedPages = new Map<number, string>();
    const extractionWarnings: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const lines = groupTextIntoLines(textContent.items);

      if (lines.length > 0) {
        pages.push({
          pageNumber,
          pageHeight: viewport.height,
          lines,
        });
      }
    }

    const repeatedEdgeKeys = detectRepeatedEdgeKeys(pages);
    for (const page of pages) {
      const markdownPage = linesToMarkdown(page, repeatedEdgeKeys);
      if (markdownPage.length > 0) {
        extractedPages.set(page.pageNumber, markdownPage);
      }
    }

    const pagesNeedingOcr: number[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (!extractedPages.has(pageNumber)) {
        pagesNeedingOcr.push(pageNumber);
      }
    }

    if (pagesNeedingOcr.length > 0) {
      try {
        const ocrPages = await extractPagesWithLocalOcr(pdfData, pagesNeedingOcr);
        for (const [pageNumber, markdownPage] of ocrPages.entries()) {
          extractedPages.set(pageNumber, markdownPage);
        }

        if (ocrPages.size > 0) {
          extractionWarnings.push(`Used local OCR for ${ocrPages.size} page(s).`);
        }

        const missingAfterOcr = pagesNeedingOcr.filter(
          (pageNumber) => !extractedPages.has(pageNumber),
        ).length;
        if (missingAfterOcr > 0) {
          extractionWarnings.push(
            `${missingAfterOcr} page(s) still had no extractable text after OCR.`,
          );
        }
      } catch (error) {
        if (extractedPages.size === 0) {
          throw error;
        }

        extractionWarnings.push(
          error instanceof Error ? error.message : "Local OCR failed.",
        );
      }
    }

    const markdownPages = Array.from(
      { length: pdf.numPages },
      (_, index) => extractedPages.get(index + 1),
    ).filter((pageContent): pageContent is string => Boolean(pageContent));

    if (markdownPages.length === 0) {
      throw new Error(
        "No readable text was found in this PDF. For scanned pages, install local OCR tools (`pdftoppm` and `tesseract`) and try again.",
      );
    }

    if (repeatedEdgeKeys.size > 0) {
      extractionWarnings.push(
        `Filtered repeated header/footer text patterns: ${repeatedEdgeKeys.size}.`,
      );
    }

    return {
      content: markdownPages.join("\n\n"),
      pageCount: pdf.numPages,
      extractionWarnings:
        extractionWarnings.length > 0 ? extractionWarnings : undefined,
    };
  } catch (error) {
    throw new Error(humanizePdfError(error));
  } finally {
    await loadingTask.destroy();
  }
}
