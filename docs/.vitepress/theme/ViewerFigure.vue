<script setup>
import { computed } from 'vue';
import { withBase } from 'vitepress';
import figures from './figures.json';
const props = defineProps({ name: { type: String, required: true }, alt: { type: String, required: true }, caption: String });
const figure = computed(() => figures[props.name]);
const unit = computed(() => figure.value.width / figure.value.display);
const extra = computed(() => figure.value.labels ? 64 * unit.value : 0);
const source = theme => withBase(`/images/${props.name}-${theme}.png`);
const labelX = index => (index + .5) * figure.value.width / figure.value.labels.length;
const badgeX = region => Math.max(14 * unit.value, region.x - 14 * unit.value);
const badgeY = region => Math.max(14 * unit.value, region.y + 12 * unit.value);
</script>

<template>
  <figure class="viewer-figure" :style="{ maxWidth: `${figure.display}px` }">
    <svg :viewBox="`0 0 ${figure.width} ${figure.height + extra}`" role="img" :aria-label="alt" class="viewer-figure-image">
      <image :href="source('light')" :width="figure.width" :height="figure.height" class="figure-light" data-theme="light" />
      <image :href="source('dark')" :width="figure.width" :height="figure.height" class="figure-dark" data-theme="dark" />
      <g v-for="(label, index) in figure.labels" :key="label.text" aria-hidden="true" class="figure-annotation">
        <path :d="`M ${label.x} ${label.y} L ${label.x} ${figure.height + 14 * unit} L ${labelX(index)} ${figure.height + 36 * unit}`" fill="none" :stroke-width="1.5 * unit" />
        <circle :cx="label.x" :cy="label.y" :r="2.5 * unit" />
        <text :x="labelX(index)" :y="figure.height + 54 * unit" text-anchor="middle" :font-size="15 * unit" font-weight="600">{{ label.text }}</text>
      </g>
      <g v-for="region in figure.regions" :key="region.number" aria-hidden="true" class="figure-region">
        <rect :x="region.x" :y="region.y" :width="region.width" :height="region.height" :rx="5 * unit" fill="none" :stroke-width="2 * unit" />
        <circle :cx="badgeX(region)" :cy="badgeY(region)" :r="11 * unit" />
        <text :x="badgeX(region)" :y="badgeY(region) + 4 * unit" text-anchor="middle" :font-size="13 * unit" font-weight="700">{{ region.number }}</text>
      </g>
    </svg>
    <figcaption v-if="caption || figure.regions">
      <p v-if="caption">{{ caption }}</p>
      <ol v-if="figure.regions" class="figure-key">
        <li v-for="region in figure.regions" :key="region.number">{{ region.text }}</li>
      </ol>
    </figcaption>
  </figure>
</template>
