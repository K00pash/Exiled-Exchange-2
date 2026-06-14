<template>
  <!-- Root is intentionally empty inline; both layers teleport to <body> and
       are gated by local refs, so the widget-manager's show/hide never
       affects this panel (which previously caused it to get stuck visible). -->
  <div style="display: none">
    <!-- Fullscreen area-selection layer -->
    <teleport to="body">
      <div
        v-if="selecting"
        :class="$style.selectLayer"
        @mousedown="onDown"
        @mousemove="onMove"
        @mouseup="onUp"
      >
        <div :class="$style.hint">
          Выделите область с наградами — отпустите для прайс-чека (Esc — отмена)
        </div>
        <div
          v-if="selRect"
          :class="$style.selRect"
          :style="{
            left: selRect.x + 'px',
            top: selRect.y + 'px',
            width: selRect.w + 'px',
            height: selRect.h + 'px',
          }"
        />
      </div>
    </teleport>

    <!-- Result panel -->
    <teleport to="body">
      <div v-if="panelOpen" :class="$style.panel" :style="panelStyle">
        <div
          class="widget-default-style p-2 flex flex-col gap-1"
          style="min-width: 20rem"
        >
          <div class="flex justify-between items-center gap-2">
            <span class="font-bold">Награды лиги — прайс-чек</span>
            <div class="flex items-center gap-2">
              <span v-if="confidence != null" class="text-gray-500 text-sm">
                OCR {{ Math.round(confidence) }}%
              </span>
              <button class="btn leading-none" title="Закрыть" @click="close">
                <i class="fas fa-times" />
              </button>
            </div>
          </div>

          <div v-if="loading" class="text-center p-4">
            <i class="fas fa-spinner fa-spin" /> Распознаю…
          </div>

          <div v-else-if="ocrError" class="text-red-400 text-sm p-2">
            {{ ocrError }}
          </div>

          <template v-else>
            <div v-if="rows.length" class="flex flex-col">
              <div
                v-for="(row, i) in rows"
                :key="i"
                class="flex justify-between gap-3 py-0.5"
              >
                <span class="truncate">
                  <span v-if="row.count > 1" class="text-gray-500"
                    >{{ row.count }}× </span
                  >{{ row.displayName }}
                </span>
                <span v-if="row.value" class="whitespace-nowrap">{{
                  fmt(row.value)
                }}</span>
                <span v-else class="text-gray-600 whitespace-nowrap"
                  >— нет цены</span
                >
              </div>

              <div
                class="flex justify-between border-t border-gray-700 mt-1 pt-1 font-bold"
              >
                <span>Итого</span>
                <span v-if="total">{{ fmt(total) }}</span>
                <span v-else class="text-gray-600">—</span>
              </div>
            </div>

            <div v-else class="text-center p-4 text-gray-500">
              Ничего не распознано
            </div>

            <div v-if="unrecognized.length" class="text-gray-600 text-sm mt-1">
              Не распознано: {{ unrecognized.join(", ") }}
            </div>
          </template>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script lang="ts">
import type { WidgetSpec } from "../overlay/interfaces";
import type { RewardCheckWidget } from "../overlay/widgets";

export default {
  widget: {
    type: "reward-check",
    instances: "single",
    initInstance: (): RewardCheckWidget => {
      return {
        wmId: 0,
        wmType: "reward-check",
        wmTitle: "{icon=fa-crop}",
        wmWants: "hide",
        wmZorder: null,
        wmFlags: ["menu::skip"],
        anchor: { pos: "tl", x: 50, y: 20 },
        areaOcrKey: null,
      };
    },
  } satisfies WidgetSpec,
};
</script>

<script setup lang="ts">
import { shallowRef, computed, onMounted, onUnmounted } from "vue";
import { Host } from "@/web/background/IPC";
import {
  usePoeninja,
  type CurrencyValue,
  displayRounding,
} from "@/web/background/Prices";
import { tokenizeRewardText } from "./tokenize";

defineProps<{ config: RewardCheckWidget }>();

const { findPriceByQuery, autoCurrency, queuePricesFetch } = usePoeninja();

interface PricedRow {
  displayName: string;
  count: number;
  unitDivine?: number;
  value?: CurrencyValue;
}

const selecting = shallowRef(false);
const dragging = shallowRef(false);
const dragStart = shallowRef<{ x: number; y: number } | null>(null);
const dragCur = shallowRef<{ x: number; y: number } | null>(null);

const panelOpen = shallowRef(false);
const panelPos = shallowRef<{ x: number; y: number }>({ x: 100, y: 100 });
const loading = shallowRef(false);
const confidence = shallowRef<number | null>(null);
const rows = shallowRef<PricedRow[]>([]);
const unrecognized = shallowRef<string[]>([]);
const total = shallowRef<CurrencyValue | undefined>(undefined);
const ocrError = shallowRef<string | null>(null);
let ocrTimer: ReturnType<typeof setTimeout> | undefined;

const selRect = computed(() => {
  if (!dragStart.value || !dragCur.value) return null;
  return {
    x: Math.min(dragStart.value.x, dragCur.value.x),
    y: Math.min(dragStart.value.y, dragCur.value.y),
    w: Math.abs(dragStart.value.x - dragCur.value.x),
    h: Math.abs(dragStart.value.y - dragCur.value.y),
  };
});

const panelStyle = computed(() => {
  const x = Math.max(8, Math.min(panelPos.value.x, window.innerWidth - 360));
  const y = Math.max(8, Math.min(panelPos.value.y, window.innerHeight - 140));
  return { left: x + "px", top: y + "px" };
});

function onDown(e: MouseEvent) {
  dragging.value = true;
  dragStart.value = { x: e.clientX, y: e.clientY };
  dragCur.value = { x: e.clientX, y: e.clientY };
}
function onMove(e: MouseEvent) {
  if (dragging.value) dragCur.value = { x: e.clientX, y: e.clientY };
}
function onUp() {
  dragging.value = false;
  const r = selRect.value;
  selecting.value = false;
  if (!r || r.w < 4 || r.h < 4) return;
  panelPos.value = { x: r.x, y: r.y + r.h + 8 };
  loading.value = true;
  ocrError.value = null;
  panelOpen.value = true;
  Host.sendEvent({
    name: "CLIENT->MAIN::area-selected",
    payload: {
      rect: { x: r.x, y: r.y, width: r.w, height: r.h },
      dpr: window.devicePixelRatio,
    },
  });
  clearTimeout(ocrTimer);
  ocrTimer = setTimeout(() => {
    if (loading.value) {
      loading.value = false;
      ocrError.value =
        "OCR не ответил — перезапусти main (worker vision.js пересобирается при старте main).";
    }
  }, 12000);
}

function close() {
  panelOpen.value = false;
  selecting.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (selecting.value) {
    selecting.value = false;
    dragging.value = false;
  } else if (panelOpen.value) {
    close();
  }
}

function fmt(value: CurrencyValue): string {
  const abbrev = { exalted: "ex", chaos: "c", div: "div" }[value.currency];
  return `${displayRounding(value.min, false, true)} ${abbrev}`;
}

function processOcr(text: string, conf: number) {
  confidence.value = conf;
  loading.value = false;
  queuePricesFetch();

  const { recognized, unrecognized: unrec } = tokenizeRewardText(text);
  unrecognized.value = unrec;

  rows.value = recognized.map((tok): PricedRow => {
    const price = findPriceByQuery({ ns: tok.ns, name: tok.name });
    const unitDivine = price?.primaryValue;
    return {
      displayName: tok.displayName,
      count: tok.count,
      unitDivine,
      value:
        unitDivine != null ? autoCurrency(unitDivine * tok.count) : undefined,
    };
  });

  const totalDivine = rows.value.reduce(
    (sum, row) => sum + (row.unitDivine ?? 0) * row.count,
    0,
  );
  total.value = totalDivine > 0 ? autoCurrency(totalDivine) : undefined;
}

const offStart = Host.onEvent("MAIN->CLIENT::start-area-select", () => {
  selecting.value = true;
  dragging.value = false;
  dragStart.value = null;
  dragCur.value = null;
  panelOpen.value = false;
  rows.value = [];
  unrecognized.value = [];
  total.value = undefined;
  confidence.value = null;
  loading.value = false;
  ocrError.value = null;
  clearTimeout(ocrTimer);
});

const offOcr = Host.onEvent("MAIN->CLIENT::reward-ocr", (e) => {
  clearTimeout(ocrTimer);
  panelOpen.value = true;
  if (e.error) {
    loading.value = false;
    ocrError.value = e.error;
    rows.value = [];
    unrecognized.value = [];
    total.value = undefined;
    confidence.value = e.confidence ?? null;
    return;
  }
  ocrError.value = null;
  processOcr(e.text, e.confidence);
});

// Hide panel/selection when focus returns to the game.
const offFocus = Host.onEvent("MAIN->OVERLAY::focus-change", (e) => {
  if (e.game) {
    panelOpen.value = false;
    selecting.value = false;
  }
});

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  offStart.abort();
  offOcr.abort();
  offFocus.abort();
});
</script>

<style lang="postcss" module>
.selectLayer {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
  background: rgba(0, 0, 0, 0.15);
}
.selRect {
  position: absolute;
  border: 1px solid theme("colors.blue.400");
  background: rgba(96, 165, 250, 0.15);
  pointer-events: none;
}
.hint {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  @apply bg-gray-800 text-gray-200 rounded px-2 py-1 text-sm;
  pointer-events: none;
}
.panel {
  position: fixed;
  z-index: 9998;
}
</style>
