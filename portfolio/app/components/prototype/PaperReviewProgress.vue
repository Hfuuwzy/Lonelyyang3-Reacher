<template>
  <section
    data-testid="paper-review-progress"
    class="paper-review-progress"
    aria-labelledby="paper-review-progress-title"
  >
    <p id="paper-review-progress-title" class="paper-review-progress__title">审阅进行中</p>
    <p class="paper-review-progress__status" role="status">正在执行：{{ currentStageLabel }}</p>
    <ol class="paper-review-progress__steps">
      <li
        v-for="step in PAPER_REVIEW_STAGE_STEPS"
        :key="step.stage"
        :aria-current="step.stage === currentStage ? 'step' : undefined"
        :class="['paper-review-progress__step', `paper-review-progress__step--${stepState(step.stage)}`]"
      >
        <span class="paper-review-progress__ordinal" aria-hidden="true">{{ step.ordinal }}</span>
        <span>{{ step.label }}</span>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import type { PaperReviewStage } from '~/utils/paper-review-contract'
import { PAPER_REVIEW_STAGE_STEPS, paperReviewStageLabel } from './paper-review-labels'

interface Props {
  readonly currentStage: PaperReviewStage
}

const props = defineProps<Props>()

const currentStageLabel = computed(() => paperReviewStageLabel(props.currentStage))

const currentStageIndex = computed(() =>
  PAPER_REVIEW_STAGE_STEPS.findIndex((step) => step.stage === props.currentStage),
)

function stepState(stage: PaperReviewStage): 'done' | 'current' | 'pending' {
  const index = PAPER_REVIEW_STAGE_STEPS.findIndex((step) => step.stage === stage)
  if (index === currentStageIndex.value) {
    return 'current'
  }
  return index < currentStageIndex.value ? 'done' : 'pending'
}
</script>

<style scoped>
.paper-review-progress {
  display: grid;
  gap: 16px;
  padding-block: 28px;
  border-block-end: 1px dotted var(--rule);
}

.paper-review-progress__title {
  margin: 0;
  color: var(--ink);
  font: 600 20px/1.4 var(--font-mincho);
}

.paper-review-progress__status {
  margin: 0;
  color: var(--vermilion);
  font-size: 15px;
  line-height: 1.6;
}

.paper-review-progress__steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.paper-review-progress__step {
  display: flex;
  align-items: center;
  gap: 10px;
  min-block-size: 44px;
  padding: 8px 10px;
  border: 1px solid var(--rule);
  border-radius: 0;
  color: var(--ink-soft);
  font-size: 14px;
}

.paper-review-progress__step--current {
  border-color: var(--vermilion);
  color: var(--ink);
}

.paper-review-progress__step--done {
  color: var(--ink);
}

.paper-review-progress__ordinal {
  display: inline-grid;
  flex: none;
  place-items: center;
  inline-size: 24px;
  block-size: 24px;
  border: 1px solid currentColor;
  color: inherit;
  font-size: 13px;
  line-height: 1;
}

.paper-review-progress__step--done .paper-review-progress__ordinal {
  border-color: var(--vermilion);
  color: var(--vermilion);
}

@media (width < 768px) {
  .paper-review-progress__steps {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
