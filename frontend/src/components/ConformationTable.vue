<template>
  <div class="panel" style="margin-top:16px">
    <div class="table-header">
      <h3>📋 构象数据 (共 {{ confs.length }} 条)</h3>
      <div class="actions">
        <template v-if="selection.length">
          <span class="sel-info">已勾选 {{ selection.length }} 行</span>
          <el-button size="small" text type="danger" @click="clearSelection">清空勾选</el-button>
        </template>
        <el-button size="small" :disabled="exporting" @click="exportCSV">导出 CSV</el-button>
        <el-button size="small" type="primary" @click="openDownload">自定义下载</el-button>
      </div>
    </div>
    <el-alert
      v-if="overLimit"
      class="limit-alert"
      type="error"
      show-icon
      :closable="false"
      :title="overLimitText"
    />
    <el-table
      ref="tableRef"
      :data="confs"
      row-key="id"
      stripe
      max-height="360"
      highlight-current-row
      @row-click="onRowClick"
      @selection-change="onSelectionChange"
      size="small"
    >
      <el-table-column type="selection" width="45" reserve-selection />
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="phi" label="φ (°)" width="100">
        <template #default="{ row }">{{ row.phi.toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="psi" label="ψ (°)" width="100">
        <template #default="{ row }">{{ row.psi.toFixed(2) }}</template>
      </el-table-column>
      <el-table-column prop="energy" label="LJ能量 (kcal/mol)" width="150">
        <template #default="{ row }">{{ row.energy.toFixed(3) }}</template>
      </el-table-column>
      <el-table-column prop="region" label="构象区域" width="120">
        <template #default="{ row }">
          <el-tag :type="tagType(row.region)" size="small">{{ regionLabel(row.region) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="cluster" label="聚类" />
    </el-table>

    <el-dialog v-model="dialogVisible" title="下载构象数据" width="560px">
      <el-form label-width="90px">
        <el-form-item label="下载范围">
          <el-radio-group v-model="scope">
            <el-radio label="all">当前显示的全部记录（{{ confs.length }} 条）</el-radio>
            <el-radio label="selected" :disabled="!selection.length">
              仅勾选的记录（当前范围内 {{ effectiveSelected.length }} 条）
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择列">
          <el-checkbox-group v-model="checkedColumns">
            <el-checkbox v-for="c in COLUMN_OPTIONS" :key="c.key" :label="c.key">{{ c.label }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="文件格式">
          <el-radio-group v-model="format">
            <el-radio-button label="csv">CSV</el-radio-button>
            <el-radio-button label="json">JSON</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <el-alert
        v-if="scope === 'all' && !confs.length"
        class="dlg-alert" type="warning" show-icon :closable="false"
        title="当前显示范围内没有记录，无法生成文件。请调整筛选条件或重新采样。"
      />
      <template v-else-if="scope === 'selected'">
        <el-alert
          v-if="!selection.length"
          class="dlg-alert" type="warning" show-icon :closable="false"
          title="尚未勾选任何记录。请先在数据表中勾选需要下载的行。"
        />
        <el-alert
          v-else-if="!effectiveSelected.length"
          class="dlg-alert" type="error" show-icon :closable="false"
          :title="`勾选的 ${selection.length} 行均不在当前显示范围内（已被筛选排除），不会生成空文件。请调整筛选条件或重新勾选。`"
        />
        <el-alert
          v-else-if="overLimit"
          class="dlg-alert" type="error" show-icon :closable="false"
          :title="overLimitText"
        />
        <el-alert
          v-else-if="hiddenSelected > 0"
          class="dlg-alert" type="warning" show-icon :closable="false"
          :title="`有 ${hiddenSelected} 条勾选记录不在当前显示范围内，将不会包含在文件中。`"
        />
      </template>
      <el-alert
        v-if="!checkedColumns.length"
        class="dlg-alert" type="warning" show-icon :closable="false"
        title="请至少选择一列。"
      />

      <template #footer>
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button type="primary" :loading="downloading" :disabled="!canConfirm" @click="confirmDownload">
          确认下载
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { useProteinStore } from '../store/protein'
import type { Conformation } from '../types'

/** 单次勾选下载允许的最大行数 */
const MAX_SELECTION = 500

const COLUMN_OPTIONS = [
  { key: 'id', label: '编号' },
  { key: 'angles', label: '二面角 (φ/ψ)' },
  { key: 'energy', label: '能量' },
  { key: 'region', label: '构象区域' },
  { key: 'cluster', label: '聚类' },
]
const CSV_HEADERS: Record<string, string> = {
  id: '编号', phi: 'φ (°)', psi: 'ψ (°)', energy: 'LJ能量 (kcal/mol)', region: '构象区域', cluster: '聚类',
}

const store = useProteinStore()
const confs = computed(() => (store.result?.conformations || []).filter(c =>
  store.selectedCluster === 'all' || c.cluster === store.selectedCluster
))

const tableRef = ref<{ clearSelection: () => void }>()
const selection = ref<Conformation[]>([])
const dialogVisible = ref(false)
const downloading = ref(false)
const exporting = ref(false)
const scope = ref<'all' | 'selected'>('all')
const format = ref<'csv' | 'json'>('csv')
const checkedColumns = ref<string[]>(COLUMN_OPTIONS.map(c => c.key))

/** 勾选项中与表格当前显示记录逐行对应的部分，顺序与表格显示保持一致 */
const effectiveSelected = computed(() => {
  const ids = new Set(selection.value.map(r => r.id))
  return confs.value.filter(c => ids.has(c.id))
})
/** 勾选后被当前筛选排除、不在显示范围内的行数 */
const hiddenSelected = computed(() => selection.value.length - effectiveSelected.value.length)
const overLimit = computed(() => effectiveSelected.value.length > MAX_SELECTION)
/** 超出上限、需要取消勾选的行（按当前显示顺序保留前 MAX_SELECTION 行） */
const rowsToCancel = computed(() => (overLimit.value ? effectiveSelected.value.slice(MAX_SELECTION) : []))

function fmtIds(list: Conformation[], max = 30) {
  const ids = list.map(c => c.id)
  const head = ids.slice(0, max).join('、')
  return ids.length > max ? `${head} …（共 ${ids.length} 行）` : head
}

const overLimitText = computed(() => {
  const total = effectiveSelected.value.length
  return `已勾选 ${total} 行，超出单次下载上限 ${MAX_SELECTION} 行，请再取消 ${total - MAX_SELECTION} 行后才能继续。` +
    `需取消的行（按当前显示顺序）：${fmtIds(rowsToCancel.value)}。` +
    `当前已选中：${fmtIds(effectiveSelected.value)}。`
})

const canConfirm = computed(() => {
  if (downloading.value || !checkedColumns.value.length) return false
  if (scope.value === 'all') return confs.value.length > 0
  return effectiveSelected.value.length > 0 && !overLimit.value
})

function onRowClick(row: Conformation) { store.selectConformation(row) }
function onSelectionChange(rows: Conformation[]) { selection.value = rows }
function clearSelection() { tableRef.value?.clearSelection() }
/** 新一轮采样后原有勾选已失效，避免旧 id 误匹配新数据 */
watch(() => store.result, () => clearSelection())

function tagType(r: string) {
  const m: Record<string, any> = { 'alpha-helix': 'success', 'beta-sheet': 'danger', 'left-helix': 'warning' }
  return m[r] || 'info'
}
function regionLabel(r: string) {
  const m: Record<string, string> = { 'alpha-helix': 'α-螺旋', 'beta-sheet': 'β-折叠', 'left-helix': '左手螺旋', 'disallowed': '禁阻区' }
  return m[r] || r
}

function openDownload() {
  scope.value = selection.value.length ? 'selected' : 'all'
  dialogVisible.value = true
}

function saveFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function buildRows(list: Conformation[]) {
  const cols = checkedColumns.value
  return list.map(c => {
    const row: Record<string, string | number> = {}
    if (cols.includes('id')) row.id = c.id
    if (cols.includes('angles')) { row.phi = c.phi; row.psi = c.psi }
    if (cols.includes('energy')) row.energy = c.energy
    if (cols.includes('region')) row.region = regionLabel(c.region)
    if (cols.includes('cluster')) row.cluster = c.cluster
    return row
  })
}

function toCSV(rows: Record<string, string | number>[]) {
  const keys = Object.keys(rows[0])
  const header = keys.map(k => CSV_HEADERS[k]).join(',')
  const body = rows.map(r => keys.map(k => r[k]).join(',')).join('\n')
  return '\uFEFF' + header + '\n' + body // 带 BOM，保证 Excel 正确显示中文
}

async function confirmDownload() {
  if (downloading.value) return
  if (!checkedColumns.value.length) { ElMessage.warning('请至少选择一列'); return }
  if (scope.value === 'selected' && overLimit.value) {
    ElMessage.error(`勾选数量超出上限 ${MAX_SELECTION} 行，请先取消部分勾选`)
    return
  }
  const list = scope.value === 'all' ? confs.value : effectiveSelected.value
  if (!list.length) {
    ElMessage.warning(scope.value === 'all'
      ? '当前显示范围内没有记录，未生成文件。'
      : '勾选的记录均不在当前显示范围内，未生成空文件。')
    return
  }
  downloading.value = true
  try {
    await nextTick()
    const rows = buildRows(list)
    const name = `conformations_${scope.value === 'all' ? 'all' : 'selected'}`
    if (format.value === 'csv') {
      saveFile(toCSV(rows), `${name}.csv`, 'text/csv;charset=utf-8')
    } else {
      saveFile(JSON.stringify(rows, null, 2), `${name}.json`, 'application/json;charset=utf-8')
    }
    ElMessage.success(`已下载 ${list.length} 条记录`)
    dialogVisible.value = false
  } finally {
    downloading.value = false
  }
}

function exportCSV() {
  if (exporting.value) return
  if (!confs.value.length) {
    ElMessage.warning('当前显示范围内没有记录，未生成文件。')
    return
  }
  exporting.value = true
  try {
    const header = 'id,phi,psi,energy,region,cluster\n'
    const rows = confs.value.map(c => `${c.id},${c.phi},${c.psi},${c.energy},${c.region},${c.cluster}`).join('\n')
    saveFile(header + rows, 'conformations.csv', 'text/csv')
  } finally {
    setTimeout(() => { exporting.value = false }, 500)
  }
}
</script>

<style scoped>
.panel { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.table-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.table-header h3 { color: #333; font-size: 15px; }
.actions { display: flex; align-items: center; gap: 8px; }
.sel-info { font-size: 13px; color: #606266; }
.limit-alert { margin-bottom: 12px; }
.dlg-alert { margin-bottom: 12px; }
</style>
