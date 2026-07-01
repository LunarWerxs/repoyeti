<script setup lang="ts">
// A Settings card whose body collapses behind a clickable header. The open/closed state
// is remembered per `sectionId` (see lib/settings-sections.ts), so reopening the panel
// restores how the user last left each section.
import type { Component } from "vue";
import { ChevronDown } from "@lucide/vue";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { useSectionOpen } from "@/lib/settings-sections";

const props = withDefaults(
  defineProps<{
    /** Stable storage key — the expanded/collapsed choice persists under this id. */
    sectionId: string;
    title: string;
    /** Lucide icon component shown left of the title. */
    icon?: Component;
    iconClass?: string;
    /** Optional blurb rendered above the slot (was the CardDescription). */
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
      <CollapsibleTrigger
        class="group flex w-full items-center gap-2 px-4 py-3.5 text-left transition-colors hover:bg-secondary/30"
      >
        <component :is="icon" v-if="icon" :size="15" :class="iconClass" class="shrink-0" />
        <span class="text-[13px] font-semibold">{{ title }}</span>
        <ChevronDown
          :size="16"
          aria-hidden="true"
          class="ml-auto shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div :class="cn('border-t border-border/60 px-4 py-4', bodyClass)">
          <p v-if="description" class="text-[12px] leading-relaxed text-muted-foreground">
            {{ description }}
          </p>
          <slot />
        </div>
      </CollapsibleContent>
    </Collapsible>
  </Card>
</template>
