import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';
import {mergeReports, groupItems, dateValue, dateColor} from './report_data.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--template') args.template = true;
  else if (['--input', '--previous', '--xlsx', '--ledger', '--preview', '--font'].includes(key)) {
    const value = process.argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${key}`);
    args[key.slice(2)] = value;
  } else throw new Error(`Unknown argument: ${key}`);
}
if (!args.xlsx || (!args.template && (!args.input || !args.ledger))) {
  throw new Error('Use --input report.json [--previous ledger.json] --xlsx new.xlsx --ledger new.json [--preview prefix]; or --template --xlsx new.xlsx');
}
if (args.template && (args.input || args.previous || args.ledger)) throw new Error('Template mode does not use business inputs');

const readJSON = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const ledger = args.template ? null : mergeReports(await readJSON(args.input), args.previous ? await readJSON(args.previous) : null);
const previewPaths = args.preview ? (ledger ? ledger.days.map(d => `${args.preview}-${d.date}.png`) : [`${args.preview}.png`]) : [];
const outputPaths = [args.xlsx, ...(args.ledger ? [args.ledger] : []), ...previewPaths].map(p => path.resolve(p));
if (new Set(outputPaths).size !== outputPaths.length) throw new Error('Output paths must be distinct');
for (const output of outputPaths) {
  try { await fs.access(output); throw new Error(`Output exists; use a new revision path: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(output), {recursive: true});
}

const wb = Workbook.create();
const sheet = wb.worksheets.add('工作日报');
const font = args.font ?? 'Helvetica Neue';
const lastRow = ledger ? 3 + ledger.days.reduce((n, d) => n + d.items.length + 1, 0) : 10;
const all = sheet.getRange(`A1:D${lastRow}`);
all.format.font = {name: font, size: 12, color: '#243447'};
all.format.fill = '#FFFFFF';
all.format.horizontalAlignment = 'center';
all.format.verticalAlignment = 'center';
all.format.wrapText = true;
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(3);
for (const [col, width] of [['A', 110], ['B', 205], ['C', 440], ['D', 290]]) {
  sheet.getRange(`${col}1:${col}${lastRow}`).format.columnWidthPx = width;
}
sheet.mergeCells('A1:D1');
sheet.getRange('A1').values = [['工作日报']];
sheet.getRange('A1:D1').format.font = {name: font, size: 22, bold: true, color: '#233B53'};
sheet.getRange('A1:D1').format.rowHeightPx = 46;
sheet.getRange('A2:D2').format.rowHeightPx = 8;
sheet.getRange('A3:D3').values = [['分类', '项目', '今日进展', '待跟进']];
sheet.getRange('A3:D3').format.fill = '#E8EEF4';
sheet.getRange('A3:D3').format.font = {name: font, size: 12, bold: true, color: '#233B53'};
sheet.getRange('A3:D3').format.rowHeight = 27;

function dateBand(row, date, color) {
  const address = `A${row}:D${row}`;
  sheet.mergeCells(address);
  sheet.getRange(`A${row}`).values = [[date]];
  const range = sheet.getRange(address);
  if (date instanceof Date) range.setNumberFormat('yyyy-mm-dd');
  range.format.font = {name: font, size: 16, color: '#64748B'};
  range.format.fill = color;
  range.format.rowHeight = 27;
}

function displayText(s) { return s.startsWith('=') ? `'${s}` : s; }
function lineCount(s, pixelWidth) {
  // Conservative estimate with CJK full-width glyphs, then inspect the rendered result.
  const capacity = (pixelWidth - 24) / 16;
  return s.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil([...line].reduce((n, ch) => n + (/[^\x00-\x7F]/.test(ch) ? 1 : 0.56), 0) / capacity)), 0);
}
function bodyRow(row, values, index) {
  const range = sheet.getRange(`A${row}:D${row}`);
  range.values = [values.map(displayText)];
  range.format.fill = index % 2 ? '#F6F8FA' : '#FFFFFF';
  range.format.rowHeight = Math.max(58.5, Math.max(...values.map((v, i) => lineCount(v, [110, 205, 440, 290][i]))) * 18 + 18);
  range.format.borders = {bottom: {style: 'thin', color: '#E2E8F0'}};
  sheet.getRange(`A${row}`).format.font = {name: font, size: 11, color: '#64748B'};
  sheet.getRange(`B${row}`).format.font = {name: font, size: 12, bold: true, color: '#243447'};
}

const sections = [];
let row = 4;
if (args.template) {
  dateBand(4, '日期', '#BFE5F2');
  for (let i = 5; i <= 7; i++) bodyRow(i, ['', '', '', ''], i - 5);
  dateBand(8, '日期', '#FCE4E4');
  for (let i = 9; i <= 10; i++) bodyRow(i, ['', '', '', ''], i - 9);
  sections.push({start: 1, end: 10});
} else {
  for (const day of ledger.days) {
    const start = row;
    dateBand(row++, dateValue(day.date), dateColor(day.date, ledger.color_anchor));
    const items = groupItems(day.items, ledger.category_order);
    const firstItemRow = row;
    items.forEach((item, i) => bodyRow(row++, [item.category, item.project, item.progress, item.follow_up], i));
    for (let first = 0; first < items.length;) {
      let last = first;
      while (last + 1 < items.length && items[last + 1].category === items[first].category) last++;
      const top = firstItemRow + first, bottom = firstItemRow + last;
      if (top < bottom) {
        sheet.getRange(`A${top + 1}:A${bottom}`).clear({applyTo: 'contents'});
        sheet.mergeCells(`A${top}:A${bottom}`);
      }
      sheet.getRange(`A${top}:A${bottom}`).format.fill = '#FFFFFF';
      first = last + 1;
    }
    sections.push({date: day.date, start, end: row - 1});
  }
}

const table = await wb.inspect({kind: 'table', range: `工作日报!A1:D${Math.min(lastRow, 18)}`, include: 'values,formulas', tableMaxRows: 18, tableMaxCols: 4, maxChars: 6000});
const errors = await wb.inspect({kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: {useRegex: true, maxResults: 30}});
console.log(table.ndjson);
console.log(errors.ndjson);

// Render before publishing final files, and keep export sidecars in a temporary directory.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'workday-report-'));
const created = [];
try {
  const staged = [];
  for (let i = 0; i < previewPaths.length; i++) {
    const section = sections[i];
    const blob = await wb.render({sheetName: '工作日报', range: `A${i === 0 ? 1 : section.start}:D${section.end}`, scale: 1.3, format: 'png'});
    const file = path.join(temp, `preview-${i}.png`);
    await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
    staged.push([file, path.resolve(previewPaths[i])]);
  }
  const xlsxTemp = path.join(temp, 'report.xlsx');
  await (await SpreadsheetFile.exportXlsx(wb)).save(xlsxTemp);
  staged.push([xlsxTemp, path.resolve(args.xlsx)]);
  if (args.ledger) {
    const jsonTemp = path.join(temp, 'ledger.json');
    await fs.writeFile(jsonTemp, JSON.stringify(ledger, null, 2) + '\n');
    staged.push([jsonTemp, path.resolve(args.ledger)]);
  }
  for (const [source, destination] of staged) {
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    created.push(destination);
  }
  console.log(JSON.stringify({xlsx: args.xlsx, days: ledger?.days.length ?? 0, items: ledger?.days.reduce((n, d) => n + d.items.length, 0) ?? 0, previews: previewPaths}));
} catch (error) {
  await Promise.all(created.map(file => fs.unlink(file)));
  throw error;
} finally {
  await fs.rm(temp, {recursive: true, force: true});
}
