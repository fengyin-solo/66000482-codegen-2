<template>
  <div class="panel" style="margin-top:16px">
    <div class="table-header">
      <h3>📋 构象数据 (共 {{ confs.length }} 条)</h3>
      <div class="header-actions">
        <el-button size="small" :disabled="downloading" @click="exportCSV">导出 CSV</el-button>
        <el-tooltip
          :disabled="checkedCount > 0 && !overLimit"
          :content="checkedCount === 0 ? '请先在表格中勾选要下载的构象行' : `勾选数量超出上限（${MAX_SELECTED_EXPORT} 行），请先取消多余行`"
          placement="top"
        >
          <span>
            <el-button
              size="small" type="primary" :disabled="downloading || checkedCount === 0 || overLimit"
              @click="openDownloadDialog"
            >⬇ 下载勾选 ({{ checkedCount }})</el-button>
          </span>
        </el-tooltip>
      </div>
    </div>

    <div class="select-bar" v-if="checkedCount > 0">
      <el-alert
        :type="overLimit ? 'error' : 'info'" :closable="false" show-icon
        :title="overLimit
          ? `已勾选 ${checkedCount} 行，超出 ${MAX_SELECTED_EXPORT} 行上限（多 ${overflowCount} 行），取消多余行后才能下载`
          : `已勾选 ${checkedCount} 行（上限 ${MAX_SELECTED_EXPORT} 行），可下载勾选行，或继续在表格中勾选`"
      >
        <template v-if="overLimit" #default>
          <div class="id-line">需要取消（{{ overflowCount }} 行）：</div>
          <div class="id-box">{{ formatIds(overflowRows) }}</div>
          <div class="id-line">已经选中（{{ checkedRowsWithinLimit.length }} 行）：</div>
          <div class="id-box">{{ formatIds(checkedRowsWithinLimit) }}</div>
          <div class="alert-actions">
            <el-button size="small" type="primary" @click="trimOverflow">取消多余行（保留最先选中的 {{ MAX_SELECTED_EXPORT }} 行）</el-button>
            <el-button size="small" @click="clearChecked">清空全部选择</el-button>
          </div>
        </template>
        <template v-else #default>
          <div class="alert-actions">
            <el-button size="small" @click="clearChecked">清空选择</el-button>
          </div>
        </template>
      </el-alert>
    </div>

    <el-table
      ref="tableRef" :key="sampleEpoch" :data="confs" stripe max-height="360"
      highlight-current-row row-key="id" size="small"
      empty-text="当前筛选条件下没有可显示的构象记录"
      @row-click="onRowClick" @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="42" reserve-selection />
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

    <el-dialog v-model="dialogVisible" title="下载勾选的构象" width="520px">
      <div class="dlg-section">
        <div class="dlg-line">
          数据表当前显示 <b>{{ confs.length }}</b> 条，已勾选 <b>{{ checkedCount }}</b> 条，
          本次将下载 <b :class="{ 'text-danger': exportRows.length === 0 }">{{ exportRows.length }}</b> 条，
          顺序与数据表当前显示逐行一致。
        </div>
        <el-alert
          v-if="excludedRows.length > 0" type="warning" :closable="false" show-icon class="dlg-alert"
          :title="`另有 ${excludedRows.length} 行已勾选，但不在数据表当前显示范围内（随后被聚类筛选排除），不会被带走`"
        >
          <div class="id-box">{{ formatIds(excludedRows) }}</div>
          <div class="alert-actions">
            <el-button size="small" @click="removeExcluded">清除这些勾选</el-button>
            <span class="dlg-hint">也可切换“全部”聚类后再下载</span>
          </div>
        </el-alert>
        <el-alert
          v-if="exportRows.length === 0" type="error" :closable="false" show-icon class="dlg-alert"
          title="没有任何勾选行与当前数据表对得上，本次不会生成文件，请先调整勾选或筛选条件"
        />
      </div>

      <div class="dlg-section">
        <div class="dlg-section-title">选择带走的列</div>
        <el-checkbox-group v-model="selectedColumns" class="col-group">
          <el-checkbox v-for="col in EXPORT_COLUMNS" :key="col.key" :value="col.key" :label="col.label" />
        </el-checkbox-group>
      </div>

      <div class="dlg-section">
        <div class="dlg-section-title">文件格式</div>
        <el-radio-group v-model="fileFormat">
          <el-radio value="csv">CSV（.csv，Excel 可直接打开）</el-radio>
          <el-radio value="json">JSON（.json）</el-radio>
        </el-radio-group>
      </div>

      <template #footer>
        <el-button @click="dialogVisible = false" :disabled="downloading">取消</el-button>
        <el-button
          type="primary" :loading="downloading"
          :disabled="exportRows.length === 0 || selectedColumns.length === 0"
          @click="confirmDownload"
        >下载 {{ exportRows.length }} 行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { TableInstance } from 'element-plus'
import { useProteinStore } from '../store/protein'
import type { Conformation } from '../types'
import {
  MAX_SELECTED_EXPORT, EXPORT_COLUMNS, regionLabel, fireDownload,
} from '@/utils/download'
import type { ExportFormat } from '@/utils/download'

const store = useProteinStore()
const tableRef = ref<TableInstance>()

/** 数据表正在显示的记录（受上方聚类筛选影响），下载范围必须与之逐行对应 */
const confs = computed<Conformation[]>(() =>
  (store.result?.conformations || []).filter(c =>
    store.selectedCluster === 'all' || c.cluster === store.selectedCluster))

// reserve-selection 让勾选行在切换聚类筛选后仍保留；重新采样时用 key 重建表格清空勾选
const sampleEpoch = ref(0)
watch(() => store.result, () => { sampleEpoch.value++; checkedRows.value = [] })

const checkedRows = ref<Conformation[]>([])
let prevCheckedCount = 0
function onSelectionChange(rows: Conformation[]) {
  checkedRows.value = rows
  if (rows.length > MAX_SELECTED_EXPORT && prevCheckedCount <= MAX_SELECTED_EXPORT) {
    ElMessage.warning(`最多只能勾选 ${MAX_SELECTED_EXPORT} 行，当前 ${rows.length} 行，请先取消多余行`)
  }
  prevCheckedCount = rows.length
}

const checkedCount = computed(() => checkedRows.value.length)
const overLimit = computed(() => checkedCount.value > MAX_SELECTED_EXPORT)
const overflowCount = computed(() => Math.max(0, checkedCount.value - MAX_SELECTED_EXPORT))
/** 按勾选先后保留在上限内的行 */
const checkedRowsWithinLimit = computed(() => checkedRows.value.slice(0, MAX_SELECTED_EXPORT))
/** 超出上限、需要取消的行（取最后勾选的若干行） */
const overflowRows = computed(() =>
  overLimit.value ? checkedRows.value.slice(MAX_SELECTED_EXPORT) : [])

const visibleIdSet = computed(() => new Set(confs.value.map(c => c.id)))
/** 与当前数据表对得上的勾选行，严格按数据表当前排序 */
const exportRows = computed(() => confs.value.filter(c => checkedIdSet.value.has(c.id)))
const checkedIdSet = computed(() => new Set(checkedRows.value.map(c => c.id)))
/** 勾选后被筛选排除、不在数据表中的行 */
const excludedRows = computed(() => checkedRows.value.filter(c => !visibleIdSet.value.has(c.id)))

const downloading = ref(false)
const dialogVisible = ref(false)
const selectedColumns = ref<(keyof Conformation)[]>(EXPORT_COLUMNS.map(c => c.key))
const fileFormat = ref<ExportFormat>('csv')

function openDownloadDialog() {
  if (checkedCount.value === 0) {
    ElMessage.warning('请先在表格中勾选要下载的构象行')
    return
  }
  if (overLimit.value) {
    ElMessage.warning(`勾选数量超出上限（${MAX_SELECTED_EXPORT} 行），请先取消多余行`)
    return
  }
  dialogVisible.value = true
}

async function confirmDownload() {
  if (downloading.value) return
  if (exportRows.value.length === 0) {
    ElMessage.warning('勾选行均已不在当前数据表显示范围内，不会生成空文件，请先调整勾选或筛选')
    return
  }
  if (selectedColumns.value.length === 0) {
    ElMessage.warning('请至少选择一列再下载')
    return
  }
  const columns = EXPORT_COLUMNS.filter(c => selectedColumns.value.includes(c.key))
  const filename = `conformations-selected.${fileFormat.value}`
  downloading.value = true
  try {
    const fired = fireDownload(filename, exportRows.value, columns, fileFormat.value)
    if (!fired) {
      ElMessage.info('该文件正在下载中，请勿重复点击；如需重新下载请稍候再试')
      return
    }
    ElMessage.success(`已按当前显示顺序导出 ${exportRows.value.length} 行到 ${filename}`)
    dialogVisible.value = false
  } finally {
    // 浏览器另存为期间按钮保持禁用；复位后可重新发起（取消后同样可重新发起）
    setTimeout(() => { downloading.value = false }, 1000)
  }
}

function trimOverflow() {
  const keep = new Set(checkedRowsWithinLimit.value.map(r => r.id))
  for (const row of checkedRows.value) {
    if (!keep.has(row.id)) tableRef.value?.toggleRowSelection(row, false)
  }
}
function clearChecked() { tableRef.value?.clearSelection() }
function removeExcluded() {
  for (const row of excludedRows.value) tableRef.value?.toggleRowSelection(row, false)
}

function formatIds(rows: Conformation[]): string {
  if (rows.length === 0) return '无'
  return rows.map(r => `#${r.id}`).join('，')
}

function onRowClick(row: Conformation, column?: { type?: string }) {
  // 点勾选框只改变选中状态，不触发表格原有的构象定位浏览行为
  if (column?.type === 'selection') return
  store.selectConformation(row)
}
function tagType(r: string) {
  const m: Record<string, string> = { 'alpha-helix': 'success', 'beta-sheet': 'danger', 'left-helix': 'warning' }
  return m[r] || 'info'
}

/** 整表下载：入口与浏览表现保持不变，下载数据表当前显示的全部记录 */
function exportCSV() {
  if (downloading.value) return
  if (confs.value.length === 0) {
    ElMessage.warning('当前没有可下载的构象记录（数据表为空），请调整筛选条件或重新生成构象采样')
    return
  }
  downloading.value = true
  try {
    const fired = fireDownload('conformations.csv', confs.value, EXPORT_COLUMNS, 'csv')
    if (!fired) {
      ElMessage.info('该文件正在下载中，请勿重复点击；如需重新下载请稍候再试')
      return
    }
    ElMessage.success(`已导出当前数据表的 ${confs.value.length} 条记录到 conformations.csv`)
  } finally {
    setTimeout(() => { downloading.value = false }, 1000)
  }
}
</script>

<style scoped>
.panel { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.table-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.table-header h3 { color: #333; font-size: 15px; }
.header-actions { display: flex; gap: 8px; }
.select-bar { margin-bottom: 12px; }
.alert-actions { margin-top: 8px; display: flex; align-items: center; gap: 8px; }
.id-line { font-size: 12px; color: #666; margin-top: 6px; }
.id-box {
  margin-top: 4px; max-height: 72px; overflow-y: auto; font-size: 12px; line-height: 1.7;
  color: #444; background: #f7f7f9; border-radius: 4px; padding: 4px 8px; word-break: break-all;
}
.dlg-section { margin-bottom: 16px; }
.dlg-section-title { font-weight: 600; font-size: 13px; color: #333; margin-bottom: 8px; }
.dlg-line { font-size: 13px; color: #555; line-height: 1.7; }
.dlg-alert { margin-top: 10px; }
.dlg-hint { font-size: 12px; color: #999; }
.text-danger { color: #f56c6c; }
.col-group { display: flex; flex-wrap: wrap; gap: 4px 16px; }
</style>
