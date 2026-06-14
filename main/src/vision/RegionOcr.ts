import * as Bindings from "./wasm-bindings";
import { cv, tessApi } from "./wasm-bindings";
import type { ImageData } from "./utils";

export interface RegionOcrResult {
  text: string;
  confidence: number;
}

/**
 * Generic OCR of an arbitrary image region (a user-selected screenshot crop).
 *
 * Unlike {@link HeistGemFinder} this makes no assumptions about layout — it
 * upscales, grayscales and binarises the crop, then runs Tesseract in
 * "uniform block of text" mode (pageseg 6) so multi-line reward text comes back
 * as newline-separated lines for the tokenizer.
 *
 * NOTE: preprocessing (scale factor / threshold / optional colour filtering)
 * will need tuning against real PoE2 reward-screen crops.
 */
export function ocrRegion(image: ImageData): RegionOcrResult {
  const colorMat = Bindings.cvMatFromImage(image);
  const work = new cv.Mat();
  try {
    // Upscale small UI text — Tesseract is much happier with larger glyphs.
    cv.resize(
      colorMat,
      work,
      new cv.Size(image.width * 2, image.height * 2),
      0,
      0,
      cv.INTER_CUBIC,
    );
    // BGRA screenshot → grayscale → Otsu binarisation. PoE renders light text
    // on a dark background, so invert to get dark-on-light for Tesseract.
    cv.cvtColor(work, work, cv.COLOR_BGRA2GRAY);
    cv.threshold(work, work, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    // Tesseract expects dark text on a light background. Auto-detect polarity:
    // light-on-dark (e.g. in-game tooltips) -> mostly dark crop -> invert;
    // dark-on-light (e.g. the parchment reward panel) -> leave as is.
    if (cv.mean(work)[0] < 128) {
      cv.bitwise_not(work, work);
    }

    Bindings.ocrSetImage(work.data, work.cols, work.rows, work.channels());
    tessApi.SetVariable("tessedit_pageseg_mode", "6");
    tessApi.Recognize();

    const text = tessApi.GetUTF8Text().trim();
    const confidence = tessApi.MeanTextConf();
    return { text, confidence };
  } finally {
    colorMat.delete();
    work.delete();
  }
}
