import { generateText } from "ai";

type PdfConversionResult = {
  content: string;
  pageCount: number;
  extractionWarnings?: string[];
};

const QWEN_PDF_PARSER_MODEL = "alibaba/qwen3.5-flash";
const MAX_MARKDOWN_LENGTH = 1_500_000;
const MAX_PROMPT_TEXT_LENGTH = 350_000;

const QWEN_PDF_SYSTEM_PROMPT = [
  "You are a PDF-to-Markdown parser.",
  "Return faithful markdown that mirrors the document layout and wording as closely as possible.",
  "Preserve headings, paragraphs, lists, tables, and code blocks.",
  "When the PDF contains meaningful figures/images, keep them represented with concise markdown descriptions and nearby captions when available.",
  "Use page separators in the form `## Page N` so downstream citation by page is possible.",
  "Do not add commentary outside the parsed document content.",
].join(" ");

const QWEN_PDF_USER_PROMPT = [
  "Parse the provided PDF page text and produce a 1:1 markdown rendering.",
  "Keep source order, include page markers as `## Page N`, and avoid summarization.",
  "Return only markdown content with no extra explanation.",
].join(" ");

function normalizeMarkdownOutput(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function humanizePdfError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Could not parse this PDF.";
}

async function extractPdfTextForPrompt(pdfData: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({
    data: pdfData,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    let pagesWithoutText = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) =>
          typeof item === "object" &&
          item !== null &&
          "str" in item &&
          typeof item.str === "string"
            ? item.str
            : "",
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (!pageText) {
        pagesWithoutText += 1;
        continue;
      }

      pages.push(`## Page ${pageNumber}\n${pageText}`);
    }

    return {
      pageCount: pdf.numPages,
      promptText: pages.join("\n\n"),
      pagesWithoutText,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function convertPdfToMarkdown(
  data: ArrayBuffer | Uint8Array,
): Promise<PdfConversionResult> {
  const pdfData =
    data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data);

  try {
    const { pageCount, promptText, pagesWithoutText } =
      await extractPdfTextForPrompt(pdfData.slice());

    if (!promptText) {
      throw new Error(
        "No extractable text was found in this PDF. The selected parser endpoint currently does not support direct PDF file parts for this model.",
      );
    }

    if (promptText.length > MAX_PROMPT_TEXT_LENGTH) {
      throw new Error(
        "The PDF text is too large for a single parsing request. Please split the PDF into smaller parts and retry.",
      );
    }

    const result = await generateText({
      model: QWEN_PDF_PARSER_MODEL,
      temperature: 0,
      system: QWEN_PDF_SYSTEM_PROMPT,
      prompt: `${QWEN_PDF_USER_PROMPT}\n\nExtracted PDF text:\n\n${promptText}`,
    });

    const normalizedMarkdown = normalizeMarkdownOutput(result.text);
    if (!normalizedMarkdown) {
      throw new Error(
        "The parser returned empty markdown. Please retry with another PDF or simplify the document.",
      );
    }

    if (normalizedMarkdown.length > MAX_MARKDOWN_LENGTH) {
      throw new Error(
        "The parsed markdown is too large to process safely. Please split the PDF and upload smaller parts.",
      );
    }

    const extractionWarnings: string[] = [];

    if (pagesWithoutText > 0) {
      extractionWarnings.push(
        `${pagesWithoutText} page(s) had no extractable text and may be incomplete.`,
      );
    }

    return {
      content: normalizedMarkdown,
      pageCount,
      extractionWarnings:
        extractionWarnings.length > 0 ? extractionWarnings : undefined,
    };
  } catch (error) {
    throw new Error(`AI PDF parsing failed: ${humanizePdfError(error)}`);
  }
}
