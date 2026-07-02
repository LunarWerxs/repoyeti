<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from "reka-ui"
import { computed, type CSSProperties, type HTMLAttributes } from "vue"
import { X } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "@/lib/utils"
import { sheetVariants, type SheetVariants } from "."
import SheetOverlay from "./SheetOverlay.vue"

interface SheetContentProps extends DialogContentProps {
  class?: HTMLAttributes["class"]
  side?: SheetVariants["side"]
  showOverlay?: boolean
  rightOffsetPx?: number
}

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SheetContentProps>(), {
  side: "right",
  showOverlay: true,
  rightOffsetPx: 0,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, "class", "side", "showOverlay", "rightOffsetPx")

const forwarded = useForwardPropsEmits(delegatedProps, emits)

const contentStyle = computed<CSSProperties | undefined>(() => {
  if (props.side !== "right" || props.rightOffsetPx <= 0) return undefined
  return { right: `${props.rightOffsetPx}px` }
})
</script>

<template>
  <DialogPortal>
    <SheetOverlay v-if="props.showOverlay" />
    <DialogContent
      data-slot="sheet-content"
      :class="cn(sheetVariants({ side }), props.class)"
      :style="contentStyle"
      v-bind="{ ...$attrs, ...forwarded }"
    >
      <slot />

      <DialogClose
        class="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
      >
        <X class="size-4" />
        <span class="sr-only">{{ $t("common.close") }}</span>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
