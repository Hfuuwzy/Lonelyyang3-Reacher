<template>
  <details v-if="props.taskId !== null && props.ready" class="paper-task-source-materials">
    <summary class="paper-task-source-materials__summary">原文图表材料 · 未覆盖范围</summary>
    <div class="paper-task-source-materials__body">
      <p class="paper-task-source-materials__note">
        图像可见性只表示原文图像是否显示，不代表模型理解；所有理解状态均未核验。
      </p>
      <p v-if="materialState.kind === 'loading'" class="paper-task-source-materials__note" role="status">
        正在读取原文材料…
      </p>
      <p v-else-if="materialState.kind === 'error'" class="paper-task-source-materials__note" role="note">
        来源信息尚未就绪，当前无法读取。
      </p>
      <template v-else-if="materialState.kind === 'loaded'">
        <p v-if="materialState.view.state === 'incomplete'" class="paper-task-source-materials__note" role="note">
          原文来源资料不完整。
        </p>
        <ul v-if="materialState.view.gaps.length > 0" class="paper-task-source-materials__gaps" aria-label="未覆盖范围">
          <li
            v-for="(gap, index) in materialState.view.gaps"
            :key="`${gap.id}-${index}`"
          >
            {{ gap.reason }}
          </li>
        </ul>
        <p v-if="materialState.view.assets.length === 0" class="paper-task-source-materials__note">
          当前没有可展示的原文图表材料。
        </p>
        <ul v-else class="paper-task-source-materials__assets" aria-label="原文图表材料">
          <li
            v-for="asset in materialState.view.assets"
            :key="asset.id"
            class="paper-task-source-materials__asset"
          >
            <p class="paper-task-source-materials__asset-title">
              {{ assetKindLabel(asset.kind) }} · 模型理解未核验
            </p>
            <figure class="paper-task-source-materials__figure">
              <img
                v-if="asset.availability === 'available' && !failedImageIds.includes(asset.id)"
                class="paper-task-source-materials__image"
                :src="paperTaskSourceAssetPath(materialState.view.taskId, asset.id)"
                :alt="`${assetKindLabel(asset.kind)}：${asset.caption}`"
                loading="lazy"
                @error="recordImageError(asset.id)"
              />
              <p
                v-else-if="asset.availability === 'available'"
                class="paper-task-source-materials__note"
                role="note"
              >
                原文图像未能显示。
              </p>
              <p v-else class="paper-task-source-materials__note" role="note">
                原文图像暂不可用。
              </p>
              <figcaption class="paper-task-source-materials__caption">{{ asset.caption }}</figcaption>
            </figure>
          </li>
        </ul>
      </template>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ref, toRef, watch } from 'vue'
import { usePaperTaskSourceMaterials } from '~/composables/paper-task-source-materials'
import {
  paperTaskSourceAssetPath,
  type PaperTaskSourceAssetId,
  type PaperTaskSourceViewAsset,
} from '~/utils/paper-task-source-view'

interface Props {
  readonly taskId: string | null
  readonly ready: boolean
}

const props = defineProps<Props>()
const materialState = usePaperTaskSourceMaterials(toRef(props, 'taskId'), toRef(props, 'ready')).state
const failedImageIds = ref<readonly PaperTaskSourceAssetId[]>([])

const SOURCE_ASSET_KIND_LABELS = {
  table: '表格',
  formula: '公式',
  algorithm: '算法',
} as const satisfies Record<PaperTaskSourceViewAsset['kind'], string>

watch(() => props.taskId, () => {
  failedImageIds.value = []
}, { flush: 'sync' })

function assetKindLabel(kind: PaperTaskSourceViewAsset['kind']): string {
  return SOURCE_ASSET_KIND_LABELS[kind]
}

function recordImageError(assetId: PaperTaskSourceAssetId): void {
  failedImageIds.value = [...failedImageIds.value, assetId]
}
</script>

<style scoped>
.paper-task-source-materials {
  margin-block-start: 1.5rem;
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 0.75rem;
}

.paper-task-source-materials__summary {
  display: flex;
  align-items: center;
  min-block-size: 44px;
  color: var(--ink);
  cursor: pointer;
  font-family: var(--font-mincho);
  font-size: 1rem;
  font-weight: 600;
}

.paper-task-source-materials__summary:focus-visible {
  outline: 3px solid var(--vermilion);
  outline-offset: 3px;
}

.paper-task-source-materials__body {
  display: grid;
  gap: 0.75rem;
  padding-block-start: 0.75rem;
}

.paper-task-source-materials__note,
.paper-task-source-materials__gaps li,
.paper-task-source-materials__caption {
  margin: 0;
  color: var(--ink-soft);
  font-size: 0.9rem;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.paper-task-source-materials__gaps,
.paper-task-source-materials__assets {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.paper-task-source-materials__asset {
  display: grid;
  gap: 0.5rem;
  min-inline-size: 0;
  border-block-start: 1px dotted var(--rule);
  padding-block-start: 0.75rem;
}

.paper-task-source-materials__asset-title {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-mincho);
  font-size: 1rem;
  font-weight: 600;
}

.paper-task-source-materials__figure {
  display: grid;
  gap: 0.5rem;
  min-inline-size: 0;
  margin: 0;
}

.paper-task-source-materials__image {
  display: block;
  max-inline-size: 100%;
  block-size: auto;
}
</style>
