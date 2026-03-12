type PdfTextItem = {
  str: string;
  transform: number[];
  hasEOL?: boolean;
};

type PdfTextLine = {
  text: string;
  y: number;
};

export type PdfConversionResult = {
  content: string;
  pageCount: number;
};

type PdfJsWorkerModule = {
  WorkerMessageHandler: unknown;
};

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
  return text.replace(/\s+/g, " ").trim();
}

function joinInlineFragments(fragments: string[]) {
  return fragments
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function groupTextIntoLines(items: unknown[]) {
  const positionedItems = items
    .filter(isPdfTextItem)
    .map((item) => ({
      text: normalizeInlineText(item.str),
      x: item.transform[4] ?? 0,
      y: item.transform[5] ?? 0,
      hasEOL: item.hasEOL ?? false,
    }))
    .filter((item) => item.text.length > 0)
    .sort((left, right) => right.y - left.y || left.x - right.x);

  const lines: Array<{ y: number; fragments: typeof positionedItems }> = [];

  for (const item of positionedItems) {
    const existingLine = lines.find((line) => Math.abs(line.y - item.y) <= 3);

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
        text: joinInlineFragments(
          [...line.fragments]
            .sort((left, right) => left.x - right.x)
            .map((fragment) => fragment.text),
        ),
      }),
    )
    .filter((line) => line.text.length > 0);
}

function linesToMarkdown(lines: PdfTextLine[], pageNumber: number) {
  if (lines.length === 0) {
    return "";
  }

  const body: string[] = [`## Page ${pageNumber}`];
  let previousY = lines[0]?.y ?? 0;

  for (const line of lines) {
    const verticalGap = Math.abs(previousY - line.y);

    if (body.length > 1 && verticalGap > 18) {
      body.push("");
    }

    body.push(line.text);
    previousY = line.y;
  }

  return body.join("\n").trim();
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

  try {
    const loadingTask = pdfjs.getDocument({
      data: pdfData,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });

    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const markdown = linesToMarkdown(
        groupTextIntoLines(textContent.items),
        pageNumber,
      );

      if (markdown) {
        pages.push(markdown);
      }
    }

    await loadingTask.destroy();

    if (pages.length === 0) {
      throw new Error(
        "No selectable text was found in this PDF. Scanned PDFs need OCR before they can be indexed.",
      );
    }

    return {
      content: pages.join("\n\n"),
      pageCount: pdf.numPages,
    };
  } catch (error) {
    throw new Error(humanizePdfError(error));
  }
}
