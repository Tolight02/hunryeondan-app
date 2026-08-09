// "로카프랩" 같은 예약제 간편식 데이터가 있을 법한 API 주소를 몇 가지 추측해서 직접 호출해봅니다.
// client.request()는 로그인 세션(쿠키)을 재사용하는 라이브러리 내부 함수라서,
// 여기서는 "내 계정으로 이미 로그인된 상태에서 다른 화면 데이터를 조회"만 하는 거라 안전해요.
// 실행: node scripts/try-reservation-endpoints.js
// 결과를 통째로 복사해서 알려주세요.

import 'dotenv/config';
import { WelstoryPlusClient } from '@pmh-only/welplan2-welstory-plus';

const client = new WelstoryPlusClient({
  username: process.env.WELSTORY_USERNAME,
  password: process.env.WELSTORY_PASSWORD,
});

const restaurants = await client.getRestaurants();
const keyword = process.env.RESTAURANT_KEYWORD || '훈련단';
const getName = (r) => r.name ?? r.restaurantName ?? r.title ?? '';
const restaurant = restaurants.find((r) => getName(r).includes(keyword));

const today = new Date();
const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

// cafeteriaActiveId 쿠키가 필요할 수 있어서 같이 넣어줌 (getMealTimes에서 쓰던 방식과 동일)
const cookieHeader = { headers: { Cookie: `cafeteriaActiveId=${restaurant.id}` } };

const candidates = [
  `/api/meal/reservation?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/reservation/meal?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/reserve?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/easy?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/hmr?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/simple?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/mypage/reservation-list?menuDt=${dateStr}&restaurantCode=${restaurant.id}`,
  `/api/reservation/list?menuDt=${dateStr}&restaurantCode=${restaurant.id}`,
  `/api/meal?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}&saleType=RESERVE`,
  `/api/meal?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}&reservationYn=Y`,
  // 아래는 이번에 새로 추가: "예약(booking/rsv)" 관련 다른 네이밍 패턴들
  `/api/rsv/meal?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/rsv/list?menuDt=${dateStr}&restaurantCode=${restaurant.id}`,
  `/api/booking/meal?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/booking/list?menuDt=${dateStr}&restaurantCode=${restaurant.id}`,
  `/api/meal/prebooking?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/precook?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/lockup?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/meal/orderMenu?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/order/meal?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}`,
  `/api/mypage/order-list?menuDt=${dateStr}&restaurantCode=${restaurant.id}`,
  // 혹시 "convenience food" 뜻의 브랜드명 자체를 courseType으로 다시 물어보는 패턴
  `/api/meal/course?menuDt=${dateStr}&menuMealType=1&restaurantCode=${restaurant.id}&courseTxt=로카프랩`,
];

console.log(`식당: ${getName(restaurant)} (${restaurant.id}), 날짜: ${dateStr}\n`);

for (const url of candidates) {
  try {
    const raw = await client.request(url, cookieHeader);
    const text = JSON.stringify(raw);
    const hasContent = text && text !== '{}' && text !== '[]' && text !== 'null';
    console.log(`\n[${hasContent ? '✅ 응답 있음' : '⚪ 비어있음'}] ${url}`);
    if (hasContent) {
      console.log(text.slice(0, 1500));
    }
  } catch (e) {
    console.log(`\n[❌ 에러] ${url}`);
    console.log('  ' + e.message);
  }
}
