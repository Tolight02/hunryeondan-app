// 설치된 @pmh-only/welplan2-welstory-plus 패키지의 실제 소스 파일을 찾아서 보여줍니다.
// components(서브메뉴)가 왜 1개만 나오는지 코드를 직접 봐야 알 수 있어서 만든 진단용 스크립트입니다.
// 실행: node scripts/inspect-source.js
// 결과 텍스트를 통째로 복사해서 알려주세요.

import fs from 'fs';
import path from 'path';

// exports 필드 제한 때문에 require.resolve가 막힐 수 있어서, node_modules 경로를 직접 찾음
const pkgDir = path.join(process.cwd(), 'node_modules', '@pmh-only', 'welplan2-welstory-plus');

if (!fs.existsSync(pkgDir)) {
  console.log('패키지 폴더를 못 찾았어요:', pkgDir);
  process.exit(1);
}

const pkgJsonPath = path.join(pkgDir, 'package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));

console.log('패키지 폴더:', pkgDir);
console.log('main:', pkgJson.main);
console.log('module:', pkgJson.module);
console.log('exports:', JSON.stringify(pkgJson.exports));

// 폴더 안의 .js 파일들을 다 나열
function listJsFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      out.push(...listJsFiles(full, base));
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

const jsFiles = listJsFiles(pkgDir);
console.log('\n=== 폴더 안 js 파일 목록 ===');
console.log(jsFiles);

// "components" 라는 단어가 들어있는 파일들을 찾아서, 그 앞뒤 코드를 보여줌
function dumpMatches(keyword) {
  console.log(`\n=== "${keyword}" 관련 코드가 있는 부분 ===`);
  for (const rel of jsFiles) {
    const full = path.join(pkgDir, rel);
    const content = fs.readFileSync(full, 'utf-8');
    if (content.includes(keyword)) {
      console.log(`\n--- 파일: ${rel} ---`);
      let idx = content.indexOf(keyword);
      let count = 0;
      while (idx !== -1 && count < 6) {
        const start = Math.max(0, idx - 300);
        const end = Math.min(content.length, idx + 300);
        console.log(`\n[위치 ${idx}]\n` + content.slice(start, end));
        idx = content.indexOf(keyword, idx + 1);
        count++;
      }
    }
  }
}

dumpMatches('components');
dumpMatches('mapCourseToMenu');
dumpMatches('getMenus');
dumpMatches('getMenuDetail');
dumpMatches('getMenuNutrientDetail');
dumpMatches('/api/');
dumpMatches('reserv');
dumpMatches('예약');
dumpMatches('searchRestaurants');
dumpMatches('addRestaurant');
dumpMatches('mapMealTime');
dumpMatches('getMealTimeList');

// 실제 getMealTimes() 결과를 직접 찍어봄 (아침/점심/저녁 구분 필드명 확인용)
console.log('\n=== 실제 getMealTimes() 결과값 ===');
try {
  const { WelstoryPlusClient } = await import('@pmh-only/welplan2-welstory-plus');
  const dotenv = await import('dotenv');
  dotenv.config();
  const client = new WelstoryPlusClient({
    username: process.env.WELSTORY_USERNAME,
    password: process.env.WELSTORY_PASSWORD,
  });
  const restaurants = await client.getRestaurants();
  const keyword = process.env.RESTAURANT_KEYWORD || '훈련단';
  const getName = (r) => r.name ?? r.restaurantName ?? r.title ?? '';
  const restaurant = restaurants.find((r) => getName(r).includes(keyword));
  const mealTimes = await client.getMealTimes(restaurant);
  console.log(JSON.stringify(mealTimes, null, 2));
} catch (e) {
  console.log('에러:', e.message);
}

// getMenus 전체 함수 몸통을 통째로 보여줌 (필터링/제외 로직이 있는지 확인용)
console.log('\n=== WelstoryPlusClient.js에서 getMenus 함수 전체 (더 넓게) ===');
{
  const full = path.join(pkgDir, 'dist', 'WelstoryPlusClient.js');
  if (fs.existsSync(full)) {
    const content = fs.readFileSync(full, 'utf-8');
    const idx = content.indexOf('async getMenus(');
    if (idx !== -1) {
      console.log(content.slice(idx, idx + 1500));
    }
  }
}
