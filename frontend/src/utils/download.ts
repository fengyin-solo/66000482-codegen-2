import type { Conformation } from '@/types'

/** 勾选下载的行数上限 */
export const MAX_SELECTED_EXPORT = 500

/** 构象区域英文标识 -> 中文名称（下载文件中始终保留中文名） */
export const REGION_LABELS: Record<string, string> = {
  'alpha-helix': 'α-螺旋',
  'beta-sheet': 'β-折叠',
  'left-helix': '左手螺旋',
  'disallowed': '禁阻区',
}

export type ExportFormat = 'csv' | 'json'

export interface ExportColumn {
  key: keyof Conformation
  label: string
  jsonKey: string
}

/** 可勾选带走的列：编号、二面角、能量、构象区域、聚类 */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'id', label: '编号', jsonKey: 'id' },
  { key: 'phi', label: 'φ (°)', jsonKey: 'phi' },
  { key: 'psi', label: 'ψ (°)', jsonKey: 'psi' },
  { key: 'energy', label: 'LJ能量 (kcal/mol)', jsonKey: 'energy' },
  { key: 'region', label: '构象区域', jsonKey: 'region' },
  { key: 'cluster', label: '聚类', jsonKey: 'cluster' },
]

export function regionLabel(region: string): string {
  return REGION_LABELS[region] ?? region
}

function csvCell(value: unknown): string {
  const s = String(value)
  // CSV 转义：包含逗号、引号或换行时用双引号包裹
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 按选中列与当前显示顺序序列化一行；区域列输出中文名称 */
function serializeRow(row: Conformation, columns: ExportColumn[]): (string | number)[] {
  return columns.map(col => col.key === 'region' ? regionLabel(row.region) : row[col.key])
}

export function buildCSV(rows: Conformation[], columns: ExportColumn[]): string {
  // 加 UTF-8 BOM，保证中文列名与区域名在 Excel 中不乱码
  return '﻿' + [columns.map(c => c.label), ...rows.map(r => serializeRow(r, columns).map(csvCell))]
    .map(line => line.join(',')).join('\r\n')
}

export function buildJSON(rows: Conformation[], columns: ExportColumn[]): string {
  const data = rows.map(row => {
    const obj: Record<string, string | number> = {}
    for (const col of columns) {
      obj[col.jsonKey] = col.key === 'region' ? regionLabel(row.region) : row[col.key]
    }
    return obj
  })
  return JSON.stringify(data, null, 2)
}

export function buildFileContent(rows: Conformation[], columns: ExportColumn[], format: ExportFormat): string {
  return format === 'csv' ? buildCSV(rows, columns) : buildJSON(rows, columns)
}

export function downloadFile(filename: string, content: string, format: ExportFormat): void {
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/**
 * 同一文件名的下载冷却：下载过程中（含浏览器另存为对话框打开期间）
 * 反复按下按钮只生效一次，不会产生多份重复文件；冷却结束后可重新发起。
 */
const LAST_FIRE_AT = new Map<string, number>()
const DOWNLOAD_COOLDOWN_MS = 1000

export function fireDownload(
  filename: string,
  rows: Conformation[],
  columns: ExportColumn[],
  format: ExportFormat,
): boolean {
  const now = Date.now()
  if ((now - (LAST_FIRE_AT.get(filename) ?? -Infinity)) < DOWNLOAD_COOLDOWN_MS) return false
  LAST_FIRE_AT.set(filename, now)
  downloadFile(filename, buildFileContent(rows, columns, format), format)
  return true
}
