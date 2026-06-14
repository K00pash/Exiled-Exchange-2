# poecheck — заметки по доработке EE2 (PoE2, лига Runes of Aldur)

Форк [Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2) (MIT). Цель: оверлей прайс-чека
PoE2 + **новая фича «прайс-чек по выделенному/скопированному тексту»** (экраны наград лиги).
Источники цен: poe.ninja (через прокси `api.exiledexchange2.dev`) + офсайт trade2 (нужен POESESSID).

## Прогресс

- ✅ EE2 склонирован в `E:\poecheck`, `npm install` (renderer+main) — оба пакета `tsc --noemit` чистые.
- ✅ Данные предметов на месте (`renderer/public/data/en/items.ndjson`, ~1.5 МБ) + индексы сгенерены
  (`npm run make-index-files`). **Контент лиги в данных есть**: Ancient Runes, Soul Cores, новая валюта.
- ✅ **Ядро фичи — токенайзер** `renderer/src/web/reward-check/tokenize.ts` + тесты
  `renderer/specs/web/reward-check/tokenize.test.ts` (6/6 зелёных, по TDD на реальных данных):
  построчный матч через `ITEM_BY_TRANSLATED` по namespace ITEM/GEM/UNIQUE, парсинг количества
  (`5x Name`, `12 Name`, `Name x5`, `Name (5)`), пропуск пустых, сбор `unrecognized`.
- ⬜ Осталось (см. «Фича наград — OCR» ниже): `ocrRegion`, слой выделения области, кроп+OCR, панель цен.
- ℹ️ Преexisting-падение `specs/web/client-log.test.ts` (мок trade-data) — баг апстрима, не наш.

## ⚠️ Корректировка дизайна (важно)

В интерфейсе PoE2 на экранах наград **НЕТ ни Ctrl+C, ни выделения текста**. Подход «читаем буфер»
НЕ работает. Фича наград = **выделение области экрана + OCR**:

1. Хоткей → прозрачный слой с растягивающимся прямоугольником (как сниппет экрана).
2. Отпустил мышь → `GameWindow.screenshot()` + кроп прямоугольника.
3. **OCR** области → текст → **токенайзер** (уже готов!) → цены (`usePoeninja`) → панель.

Токенайзер остаётся в силе — он парсит ТЕКСТ, а OCR его и даёт. Меняется только «передняя половина».

### OCR-фундамент в EE2 (переиспользуем)
- `main/src/vision/` — Tesseract + OpenCV (wasm). Поддержка **en/ru, только Windows** (ты на Windows).
- `main/src/vision/wasm-bindings.ts` — примитивы: `cv`, `tessApi.SetImage/Recognize/GetUTF8Text`, `ocrSetImage`, `cvMatFromImage`.
- `main/src/vision/HeistGemFinder.ts` — образец OCR строки (pageseg 7 + HSV-фильтр).
- `main/src/vision/link-worker.ts` (WorkerAPI) + `link-main.ts` (`OcrWorker`) — OCR в worker-треде через Comlink.
- `GameWindow.screenshot()` — пиксели окна игры (BGRA). Уже используется heist-OCR.
- `OverlayWindow.assertOverlayActive()/assertGameActive()` — перехват мыши оверлеем ↔ возврат игре.
- Действие `ocr-text` + событие `MAIN->CLIENT::ocr-text` (потребитель — `WidgetItemSearch.vue`) — шаблон потока.

### ⚠️ Зависимость: OCR-бинари (ручной шаг, [ocr-guide.md](docs/ocr-guide.md))
`cv-ocr.zip` (~6 МБ) → распаковать в `%APPDATA%\exiled-exchange-2\apt-data\cv-ocr\` (eng/rus traineddata,
tesseract-core-simd, opencv). НЕ в инсталляторе. Без этого OCR молча не инициализируется
(`OcrWorker.create` глотает ошибку init). URL: github SnosMe/awakened-poe-trade releases v3.20.10007/cv-ocr.zip.

### Фича наград — OCR: статус (РАБОТАЕТ end-to-end в игре ✅)
Подтверждено на панели Runeshape Combinations: OCR → токенайзер → цены poe.ninja с количеством + Итого.
Токенайзер ищет `Nx <Имя>` внутри шумного OCR-текста; OCR-препроцессинг — авто-полярность
(тёмный-на-светлом / светлый-на-тёмном). Шум от рун-иконок отфильтровывается (уходит в «не распознано»).

1. ✅ `main/src/vision/RegionOcr.ts`: `ocrRegion(image)` (апскейл×2 + грейскейл + Otsu + инверт, pageseg 6)
   + проброс через `link-worker.ts` (`WorkerAPI`) и `link-main.ts` (`OcrWorker.ocrRegion`).
2. ✅ `ipc/types.ts`: действие `{ type: "area-ocr" }` + события `MAIN->CLIENT::start-area-select`,
   `CLIENT->MAIN::area-selected {rect, dpr}`, `MAIN->CLIENT::reward-ocr {text, confidence}`.
3. ✅ `main/src/shortcuts/Shortcuts.ts`: ветка `area-ocr` → `assertOverlayActive()` + шлёт `start-area-select`;
   слушатель `area-selected` → `handleAreaSelected` → `screenshot()` + `cropImage(rect*dpr, clamp)` →
   `ocrWorker.ocrRegion` → шлёт `reward-ocr`.
4. ✅ Renderer `WidgetRewardCheck.vue`: слой выделения (teleport, drag-прямоугольник, Esc — отмена) →
   на mouseup шлёт `area-selected {rect, dpr}`; на `reward-ocr` → `tokenizeRewardText` →
   `findPriceByQuery`/`autoCurrency` → панель «строка → цена» + сумма + «не распознано».
5. ✅ `Config.ts`: маппинг хоткея `reward-check.areaOcrKey` → действие `area-ocr`;
   виджет-тип `RewardCheckWidget` в `overlay/widgets.ts`; регистрация в `overlay/widget-registry.ts`
   (дефолтный конфиг сам сидит single-виджет).

Проверено: `tsc` (main+renderer) чисто, `vue-tsc`+vite build renderer ОК, main esbuild bundle (`vision.js`) ОК,
тесты токенайзера 6/6, OCR-бинари `cv-ocr` провижинены в `%APPDATA%`.

### Правки по фидбэку запуска (готово)
- ✅ **Бинд в настройках**: добавлен в страницу Hotkeys ([settings/hotkeys.vue](renderer/src/web/settings/hotkeys.vue),
  строка «Reward area check» → `reward-check.areaOcrKey`). Правка config.json НЕ нужна.
- ✅ **Видимость**: панель больше не «залипает» — флаг `hide-on-blur` (скрывается при потере фокуса
  оверлея) + сброс прошлого результата при старте выделения. Видна только сразу после прайс-чека.
- ℹ️ **config.json в dev не пишется вообще**: `ConfigStore.save()` ретёрнит при `VITE_DEV_SERVER_URL`.
  Поэтому бинд — только через настройки; в dev он не персистится между перезапусками (норм для теста).
- ✅ **Лаунчер**: `dev.ps1` в корне поднимает renderer+main в двух окнах одной командой.
- ✅ **OCR-бинари реально на диске**: ранее провижинились в песочницу агента (на реальный `%APPDATA%`
  не попадали → ENOENT `eng.traineddata`). Поставлены на реальный диск. Воркер `link-worker.ts` теперь
  ретраит загрузку языка (не залипает на закешированном провале).
- ✅ **Персист конфига в dev**: убран `return` в `ConfigStore.save()` при `VITE_DEV_SERVER_URL` —
  хоткеи/лига/POESESSID теперь сохраняются между перезапусками dev (пишется `apt-data/config.json`).
- ✅ **Закрытие панели**: кнопка ✕ + Escape (`wm.hide`) — не зависит от потери фокуса (важно при GAME PAUSED).

### Осталось (требует запуска в игре)
- **Тюнинг OCR**: масштаб/порог/цветовой фильтр в `RegionOcr.ts` — подогнать на реальных кропах PoE2.
- **Маппинг координат** оверлей↔скриншот (`dpr`, возможные оффсеты окна) — проверить на реальном разрешении.
- Прайс может быть пустым, если ninja-данные ещё не загружены — прогреваются при старте/первом прайс-чеке.

## Сборка (npm, НЕ pnpm)

```
cd renderer && npm install && npm run make-index-files && npm run dev
# второй терминал:
cd main && npm install && npm run dev
```
Проверка типов: `npm run check-types` в обоих. Тесты renderer: `npm test` (vitest). Сборка: `npm run build`.
В игре нужен режим **Windowed Fullscreen**; `windowTitle` в конфиге = `Path of Exile 2`.

## Что УЖЕ сделано апстримом (не переписываем)

- **Лига уже = Runes of Aldur.** `renderer/src/web/background/Prices.ts:242` `selectedLeagueToUrl()`
  возвращает `runesofaldur` / `runesofaldurhc`. Данные poe.ninja: прокси
  `api.exiledexchange2.dev/proxy/{league}/overviewData.json` + `namespaceMap.json`.
- **Список лиг офсайта**: `renderer/src/web/background/Leagues.ts:52` → `GET {poeWebApi}/api/trade2/data/leagues`.
  Выбранный `leagueId` (строка лиги офсайта) хранится в `AppConfig().leagueId`.
- **Глобальные хоткеи + копирование предмета**: `main/src/shortcuts/Shortcuts.ts`. Действие `copy-item`
  синтезирует Ctrl+C (`pressKeysToCopyItemText`), читает буфер `HostClipboard.readItemText()`,
  шлёт событие `MAIN->CLIENT::item-text` `{target, clipboard, position, focusOverlay}`.
- **Чтение буфера**: `main/src/shortcuts/HostClipboard.ts`. `readItemText()` поллит буфер и принимает
  только текст-предмет (`isPoeItem()` — строка начинается с «Item Class:»/локализованный аналог).
- **Приём в renderer**: `renderer/src/web/price-check/PriceCheckWindow.vue:314` слушает `MAIN->CLIENT::item-text`,
  парсит и оценивает.
- **Прокси офсайта/ninja**: `main/src/proxy.ts`. `/proxy/<host>/...` → `https://<host>/...`,
  `net.request({ useSessionCookies: true })`. Белый список хостов в `PROXY_HOSTS`.
- **Рейт-лимиты офсайта**: `renderer/src/web/price-check/trade/RateLimiter.ts`.

## Готовые кирпичи для новой фичи (переиспользуем)

- **Цена по имени (poe.ninja)**: `renderer/src/web/background/Prices.ts` → `usePoeninja()`:
  `findPriceByQuery({ns, name, variant?})` и `cachedCurrencyByQuery(query, count)` → `CurrencyValue {min,max,currency}`.
  `ns` ∈ `"ITEM" | "GEM" | "UNIQUE"`.
- **Имя текста → предмет**: `renderer/src/assets/data/index.ts`:
  `ITEM_BY_TRANSLATED(ns, name)` (по локализованному отображаемому имени) и `ITEM_BY_REF(ns, name)`.
  Итераторы имён: `ITEM_NS_NAMES()`, `GEM_NS_NAMES()`, `UNIQUE_NS_NAMES()`.
- **Bulk/валюта (офсайт)**: `renderer/src/web/price-check/trade/bulk-api.ts` `useBulkApi()`,
  `pathofexile-bulk.ts`. Живой поиск листингов: `trade-api.ts`, `pathofexile-trade.ts`.
- Фуззи-матч: пакет `fastest-levenshtein` уже в зависимостях renderer.

## План доработок

### Phase 1 — POESESSID + проверка лиги
1. Добавить поле POESESSID в конфиг (`ipc/types.ts` `HostConfig` + UI настроек `renderer/src/web/settings/`).
2. На старте main инжектить cookie в сессию Electron (прокси уже с `useSessionCookies:true`):
   `session.defaultSession.cookies.set({ url: 'https://www.pathofexile.com', name: 'POESESSID', value })`.
   Точка инициализации — `main/src/main.ts` (там же создаётся `HttpProxy`).
3. Проверить, что выбранная лига офсайта = «Runes of Aldur» и ninja-данные грузятся.

### Phase 2 — фича наград
УСТАРЕЛО (буфер/выделение в PoE2 недоступны). Актуальный дизайн — раздел «Фича наград — OCR» выше.
Токенайзер `renderer/src/web/reward-check/tokenize.ts` уже готов и переиспользуется как есть.

### Phase 3 — полировка
UI настроек (хоткеи/POESESSID/лига), состояния ошибок (нет сессии → деградация на ninja + ссылка в браузер;
429 → бэкофф), упаковка `npm run package` (electron-builder).

## Риски
- Текст на экранах наград в PoE2 реально копируется? Проверить в Phase 2 первым делом. Если нет — OCR (вне объёма).
  MVP всё равно полезен: оценивает ЛЮБОЙ скопированный текст с именами (из игры/форума/трейда).
- ToS GGG: уважать рейт-лимиты (`RateLimiter.ts`), User-Agent проставляется прокси. POESESSID — только локально.
