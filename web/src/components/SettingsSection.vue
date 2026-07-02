<script setup lang="ts">
// A Settings card whose body collapses behind a clickable header. The open/closed state
// is remembered per `sectionId` (see lib/settings-sections.ts), so reopening the panel
// restores how the user last left each section.
import type { Component } from "vue";
import { ChevronDown, Info } from "@lucide/vue";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSectionOpen } from "@/lib/settings-sections";

const props = withDefaults(
  defineProps<{
    /** Stable storage key — the expanded/collapsed choice persists under this id. */
    sectionId: string;
    title: string;
    /** Lucide icon component shown left of the title. */
    icon?: Component;
    iconClass?: string;
    /** Optional blurb shown as a compact info tooltip beside the expanded title. */
    description?: string;
    /** Layout for the body container; override to match a section's spacing. */
    bodyClass?: string;
    /** Initial state before the user has ever toggled this section. */
    defaultOpen?: boolean;
  }>(),
  { iconClass: "text-muted-foreground", bodyClass: "flex flex-col gap-4", defaultOpen: false },
);

const open = useSectionOpen(props.sectionId, props.defaultOpen);
</script>

<template>
  <!-- shrink-0: these cards are flex children of the scrollable settings column; without it they
       flex-shrink to fit and `overflow-hidden` clips the header (a collapsed card would show ~22px
       of its 48px header). Keep full height and let the column scroll instead. -->
  <Card class="shrink-0 gap-0 overflow-hidden border-border bg-secondary/20 py-0 shadow-none">
    <Collapsible v-model:open="open">
      <div class="group flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors hover:bg-secondary/30">
        <CollapsibleTrigger
          type="button"
          class="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
        >
          <component :is="icon" v-if="icon" :size="15" :class="iconClass" class="shrink-0" />
          <span class="truncate text-[13px] font-semibold">{{ title }}</span>
        </CollapsibleTrigger>
        <Tooltip v-if="description && open">
          <TooltipTrigger as-child>
            <button
              type="button"
              class="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="description"
              :title="description"
            >
              <Info :size="13" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" align="center" class="max-w-72 leading-relaxed">
            {{ description }}
          </TooltipContent>
        </Tooltip>
        <CollapsibleTrigger
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="open ? `Collapse ${title}` : `Expand ${title}`"
        >
          <ChevronDown
            :size="16"
            aria-hidden="true"
            class="shrink-0 text-muted-foreground transition-transform duration-200"
            :class="open && 'rotate-180'"
          />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div :class="cn('border-t border-border/60 px-4 py-4', bodyClass)">
          <slot />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
