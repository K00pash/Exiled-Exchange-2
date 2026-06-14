import { parentPort } from "worker_threads";
import * as Comlink from "comlink";
import nodeEndpoint from "comlink/dist/umd/node-adapter";
import * as Bindings from "./wasm-bindings";
import { HeistGemFinder } from "./HeistGemFinder";
import { ocrRegion } from "./RegionOcr";
import { ImageData } from "./utils";

let _heistGems: HeistGemFinder;
let _changeLangPromise: Promise<void> = Promise.resolve();
let _lang: string | undefined;
let _binDir: string | undefined;

// Ensures the OCR language is loaded. If a previous load failed (e.g. the
// cv-ocr files were not present yet when the worker first started), retry
// instead of permanently re-throwing the cached rejection.
async function ensureLanguage() {
  try {
    await _changeLangPromise;
  } catch (err) {
    if (_lang && _binDir) {
      _changeLangPromise = Bindings.changeLanguage(_lang, _binDir);
      await _changeLangPromise;
    } else {
      throw err;
    }
  }
}

const WorkerBody = {
  async init(binDir: string) {
    _binDir = binDir;
    await Bindings.init(binDir);
    _heistGems = await HeistGemFinder.create(binDir);
  },
  async changeLanguage(lang: string, binDir: string) {
    _lang = lang;
    _binDir = binDir;
    await _changeLangPromise.catch(() => {});
    _changeLangPromise = Bindings.changeLanguage(lang, binDir);
    await _changeLangPromise;
  },
  async findHeistGems(screenshot: ImageData) {
    await ensureLanguage();
    return _heistGems.ocrScreenshot(screenshot);
  },
  async ocrRegion(image: ImageData) {
    await ensureLanguage();
    return ocrRegion(image);
  },
};
Comlink.expose(WorkerBody, nodeEndpoint(parentPort!));

export type WorkerAPI = Comlink.Remote<typeof WorkerBody>;
