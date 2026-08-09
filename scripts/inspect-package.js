// 이 라이브러리가 영양성분/상세메뉴를 가져오는 별도 함수를 제공하는지 확인하는 스크립트입니다.
// 실행: node scripts/inspect-package.js
// 결과로 나오는 텍스트를 그대로 복사해서 알려주세요.

import 'dotenv/config';
import * as pkg from '@pmh-only/welplan2-welstory-plus';
import { WelstoryPlusClient } from '@pmh-only/welplan2-welstory-plus';

console.log('=== 패키지가 내보내는 것들 ===');
console.log(Object.keys(pkg));

console.log('\n=== WelstoryPlusClient 인스턴스의 메서드들 ===');
const client = new WelstoryPlusClient({
  username: process.env.WELSTORY_USERNAME,
  password: process.env.WELSTORY_PASSWORD,
});

// 클래스 프로토타입에 정의된 함수 이름들을 뽑아봄 (영양/상세/nutri/detail 같은 이름이 있는지 확인)
const proto = Object.getPrototypeOf(client);
const methodNames = Object.getOwnPropertyNames(proto).filter((n) => typeof client[n] === 'function');
console.log(methodNames);

console.log('\n=== 메뉴 하나의 실제 원본 데이터 (JSON.stringify) ===');
let sampleMenu;
try {
  const restaurants = await client.getRestaurants();
  const keyword = process.env.RESTAURANT_KEYWORD || '훈련단';
  const getName = (r) => r.name ?? r.restaurantName ?? r.title ?? '';
  const restaurant = restaurants.find((r) => getName(r).includes(keyword));
  const mealTimes = await client.getMealTimes(restaurant);
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const menus = await client.getMenus(restaurant, dateStr, mealTimes[0].id ?? mealTimes[0].mealTimeId);
  sampleMenu = menus[0];
  console.log(JSON.stringify(sampleMenu, null, 2));
} catch (e) {
  console.log('메뉴 하나 가져오다가 에러:', e.message);
}

if (sampleMenu?.id) {
  console.log('\n=== getMenuDetail(id) 결과 (밥/국/반찬 breakdown 나오는지 확인) ===');
  try {
    const detail = await client.getMenuDetail(sampleMenu.id);
    console.log(JSON.stringify(detail, null, 2));
  } catch (e) {
    console.log('getMenuDetail 에러:', e.message);
  }

  console.log('\n=== getMenuNutrientDetail(id) 결과 ===');
  try {
    const nutrient = await client.getMenuNutrientDetail(sampleMenu.id);
    console.log(JSON.stringify(nutrient, null, 2));
  } catch (e) {
    console.log('getMenuNutrientDetail 에러:', e.message);
  }
}
