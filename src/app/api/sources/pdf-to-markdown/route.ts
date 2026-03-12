import { NextResponse } from "next/server";
import { convertPdfToMarkdown } from "@/lib/pdf-to-markdown";

export const runtime = "nodejs";

const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Please provide a PDF file." },
      { status: 400 },
    );
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Only PDF uploads are supported by this endpoint." },
      { status: 400 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json(
      { error: "The uploaded PDF is empty." },
      { status: 400 },
    );
  }

  if (file.size > MAX_PDF_SIZE_BYTES) {
    return NextResponse.json(
      {
        error:
          "This PDF is too large to process right now. Please keep uploads under 10 MB.",
      },
      { status: 413 },
    );
  }

  try {
    const pdf = await convertPdfToMarkdown(await file.arrayBuffer());

    return NextResponse.json(pdf);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not convert this PDF.",
      },
      { status: 422 },
    );
  }
}