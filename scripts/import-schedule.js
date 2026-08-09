// 사용법:
//   1) 병무청 "OOOO년도 공군 병 연간 모집일정" PDF를 열어서 표 전체를 복사
//   2) 텍스트 파일로 저장 (예: schedule-2027.txt)
//   3) node scripts/import-schedule.js schedule-2027.txt
//
// PDF에서 복사한 텍스트 안에 "(875기)" 같은 표시와, 그 블록 안에 날짜가
// 8개(지원접수 2, 1차발표 1, 신검/면접 2, 최종발표 1, 입영일자 1, 수료일자 1)
// 나온다는 규칙을 이용해서 마지막 2개(입영일자, 수료일자)만 뽑아냅니다.
// PDF 표 형식이 완전히 바뀌면 이 스크립트도 손봐야 할 수 있어요 — 그런 경우
// 새 PDF 텍스트를 저에게 다시 올려주시면 스크립트를 고쳐드릴게요.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cohortsPath = path.join(__dirname, '..', 'data', 'cohorts.json');

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('사용법: node scripts/import-schedule.js <텍스트파일경로>');
  process.exit(1);
}

const text = fs.readFileSync(inputPath, 'utf-8');

// 날짜 토큰: ’26. 8. 27.(목) / '26. 8. 27.(목) 같은 형태
const DATE_RE = /[’'`]\s*(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*\([월화수목금토일]\)/g;

function toISO(yy, mm, dd) {
  const year = 2000 + Number(yy);
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// (기수) 위치를 기준으로 블록을 나눔
const cohortMarkerRe = /\((\d{3,4})기\)/g;
const markers = [];
let m;
while ((m = cohortMarkerRe.exec(text))) {
  markers.push({ gigsu: Number(m[1]), index: m.index });
}

if (!markers.length) {
  console.error('텍스트에서 "(NNN기)" 형태를 하나도 못 찾았어요. PDF에서 표 전체를 복사했는지 확인해주세요.');
  process.exit(1);
}

const results = [];
for (let i = 0; i < markers.length; i++) {
  const start = markers[i].index;
  const end = i + 1 < markers.length ? markers[i + 1].index : text.length;
  const block = text.slice(start, end);

  const dates = [];
  let dm;
  DATE_RE.lastIndex = 0;
  while ((dm = DATE_RE.exec(block))) {
    dates.push(toISO(dm[1], dm[2], dm[3]));
  }

  if (dates.length < 2) {
    console.warn(`${markers[i].gigsu}기: 날짜를 충분히 못 찾아서 건너뜀 (찾은 개수: ${dates.length})`);
    continue;
  }

  const enlistDate = dates[dates.length - 2];
  const completionDate = dates[dates.length - 1];
  results.push({ gigsu: markers[i].gigsu, enlistDate, completionDate });
}

// 기존 cohorts.json과 병합 (같은 기수는 새 값으로 덮어씀)
const existing = JSON.parse(fs.readFileSync(cohortsPath, 'utf-8'));
const merged = new Map(existing.cohorts.map((c) => [c.gigsu, c]));
for (const r of results) merged.set(r.gigsu, r);

existing.cohorts = [...merged.values()].sort((a, b) => a.gigsu - b.gigsu);
fs.writeFileSync(cohortsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');

console.log(`${results.length}개 기수 반영 완료:`);
results.forEach((r) => console.log(`  ${r.gigsu}기: 입영 ${r.enlistDate} → 수료 ${r.completionDate}`));
console.log(`\ndata/cohorts.json 업데이트됨. 서버 재시작하면 반영됩니다 (npm start).`);
