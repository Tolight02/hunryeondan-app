import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { WelstoryPlusClient } from '@pmh-only/welplan2-welstory-plus';

const app = express();
app.use(cors());
app.use(express.json());

// ---------- 진주(공군교육사령부) 실시간 날씨 ----------
// Open-Meteo: 무료, API 키 필요 없음
const JINJU_LAT = 35.1799;
const JINJU_LON = 128.0857;

// WMO 날씨 코드 -> 이모지/설명 (Open-Meteo 기준)
function weatherCodeToInfo(code) {
  const map = {
    0: ['☀️', '맑음'], 1: ['🌤️', '대체로 맑음'], 2: ['⛅', '구름 조금'], 3: ['☁️', '흐림'],
    45: ['🌫️', '안개'], 48: ['🌫️', '안개'],
    51: ['🌦️', '이슬비'], 53: ['🌦️', '이슬비'], 55: ['🌦️', '이슬비'],
    61: ['🌧️', '비'], 63: ['🌧️', '비'], 65: ['🌧️', '강한 비'],
    71: ['🌨️', '눈'], 73: ['🌨️', '눈'], 75: ['❄️', '강한 눈'],
    80: ['🌧️', '소나기'], 81: ['🌧️', '소나기'], 82: ['⛈️', '강한 소나기'],
    95: ['⛈️', '뇌우'], 96: ['⛈️', '뇌우(우박)'], 99: ['⛈️', '뇌우(우박)'],
  };
  return map[code] || ['🌡️', '-'];
}

let weatherCache = null;
let weatherCachedAt = 0;
const WEATHER_TTL_MS = 1000 * 60 * 10; // 10분 캐시 (너무 자주 호출 안 하려고)

app.get('/api/weather', async (req, res) => {
  try {
    const now = Date.now();
    if (weatherCache && now - weatherCachedAt < WEATHER_TTL_MS) {
      return res.json(weatherCache);
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${JINJU_LAT}&longitude=${JINJU_LON}&current=temperature_2m,weather_code&timezone=Asia%2FSeoul`;
    const r = await fetch(url);
    const data = await r.json();
    const temp = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    const [emoji, label] = weatherCodeToInfo(code);
    weatherCache = { temp, emoji, label };
    weatherCachedAt = now;
    res.json(weatherCache);
  } catch (e) {
    console.error('[weather] 에러:', e.message);
    res.status(500).json({ error: '날씨 정보를 못 가져왔어요.' });
  }
});

// ---------- 일일 방문자 수 (앱 화면엔 절대 표시 안 하고, 관리자만 비밀 주소로 확인) ----------
// 날짜별로 { totalVisits: 총 방문횟수(중복 포함), uniqueVisitors: 순 방문자수, visitorIds: 그날 다녀간 익명ID 목록 } 저장
const visitsPath = new URL('./data/visits.json', import.meta.url);
function readVisits() {
  try {
    return JSON.parse(fs.readFileSync(visitsPath));
  } catch (e) {
    return {};
  }
}
function writeVisits(data) {
  fs.writeFileSync(visitsPath, JSON.stringify(data, null, 2));
}
function todayKST() {
  // 서버가 어느 시간대에 떠있든 상관없이 한국 날짜 기준으로 집계
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()); // YYYY-MM-DD
}

app.post('/api/visit', (req, res) => {
  try {
    const visits = readVisits();
    const today = todayKST();
    if (!visits[today] || typeof visits[today] !== 'object') {
      visits[today] = { totalVisits: 0, uniqueVisitors: 0, visitorIds: [] };
    }
    visits[today].totalVisits += 1;

    const visitorId = (req.body && req.body.visitorId) ? String(req.body.visitorId).slice(0, 64) : null;
    if (visitorId) {
      if (!Array.isArray(visits[today].visitorIds)) visits[today].visitorIds = [];
      if (!visits[today].visitorIds.includes(visitorId)) {
        visits[today].visitorIds.push(visitorId);
        visits[today].uniqueVisitors += 1;
      }
    }
    writeVisits(visits);
    res.json({ ok: true });
  } catch (e) {
    console.error('[visit] 에러:', e.message);
    res.status(500).json({ ok: false });
  }
});

// 관리자만 아는 주소 + 비밀키로만 조회 가능. 앱 화면 어디에도 안 뜸.
app.get('/api/admin/stats', (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: '접근 권한이 없어요.' });
  }
  const visits = readVisits();
  const dates = Object.keys(visits).sort();
  const byDate = {};
  let totalVisits = 0;
  dates.forEach((d) => {
    const entry = visits[d];
    // 예전 형식(날짜당 숫자 하나)이었던 기록과의 호환 처리
    const t = typeof entry === 'object' ? (entry.totalVisits || 0) : (entry || 0);
    const u = typeof entry === 'object' ? (entry.uniqueVisitors || 0) : 0;
    byDate[d] = { totalVisits: t, uniqueVisitors: u };
    totalVisits += t;
  });
  // 참고: 순 방문자수는 "그날 다녀간 사람 수"라서 여러 날 합산하는 건 의미가 없어요 (같은 사람이 여러 날 오면 중복 카운트됨).
  // 날짜별 uniqueVisitors 값을 각각 보시는 게 정확해요.
  res.json({ totalVisits, byDate, dates });
});

// ---------- 기수 <-> 날짜 계산 ----------

const cohortData = JSON.parse(fs.readFileSync(new URL('./data/cohorts.json', import.meta.url)));
const cohorts = cohortData.cohorts;
const FALLBACK_TRAINING_DAYS = 32; // 표에 없는 기수는 입영일+32일로 추정 (실제 875~886기 평균 패턴)

function findCohort(gigsu) {
  return cohorts.find((c) => c.gigsu === Number(gigsu));
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// 기수 또는 입소일 중 하나만 받아서, 입소일/수료일/진행률 계산
// GET /api/status?gigsu=884
// GET /api/status?enlistDate=2026-07-14
app.get('/api/status', (req, res) => {
  const { gigsu, enlistDate } = req.query;

  let resolvedEnlist, resolvedCompletion, source;

  if (gigsu) {
    const c = findCohort(gigsu);
    if (c) {
      resolvedEnlist = c.enlistDate;
      resolvedCompletion = c.completionDate || addDays(c.enlistDate, FALLBACK_TRAINING_DAYS);
      source = 'table';
    } else if (enlistDate) {
      // 표에 없는 기수인데 날짜를 알려준 경우
      resolvedEnlist = enlistDate;
      resolvedCompletion = addDays(enlistDate, FALLBACK_TRAINING_DAYS);
      source = 'estimate';
    } else {
      return res.status(404).json({
        error: `${gigsu}기는 아직 표에 없어요. 입소일을 직접 입력해주세요.`,
      });
    }
  } else if (enlistDate) {
    resolvedEnlist = enlistDate;
    resolvedCompletion = addDays(enlistDate, FALLBACK_TRAINING_DAYS);
    source = 'estimate';
  } else {
    return res.status(400).json({ error: 'gigsu 또는 enlistDate 중 하나는 필요합니다.' });
  }

  const today = new Date().toISOString().slice(0, 10);
  const totalDays = (new Date(resolvedCompletion) - new Date(resolvedEnlist)) / 86400000;
  const passedDays = Math.min(
    Math.max((new Date(today) - new Date(resolvedEnlist)) / 86400000, 0),
    totalDays
  );
  const percent = totalDays > 0 ? Math.round((passedDays / totalDays) * 1000) / 10 : 100;
  const daysLeft = Math.max(Math.ceil((new Date(resolvedCompletion) - new Date(today)) / 86400000), 0);

  res.json({
    enlistDate: resolvedEnlist,
    completionDate: resolvedCompletion,
    today,
    percent,
    daysLeft,
    source, // 'table'이면 표에 있는 확정 날짜, 'estimate'면 5주 추정치
  });
});

// 알려진 기수 목록 (프론트에서 드롭다운 채울 때 씀)
app.get('/api/cohorts', (req, res) => {
  res.json(cohorts.map((c) => c.gigsu).sort((a, b) => b - a));
});

// ---------- 신분별 설정 ----------
// 훈련병/조교는 같은 식당(훈련단)을 쓰지만, 훈련병은 "한식"만 먹고 간편식은 못 먹음.
// 특기학교/후보생은 아예 다른 식당.
const CATEGORY_CONFIG = {
  trainee: {
    label: '훈련병',
    restaurantKeyword: '훈련단',
    onlyCourseTxt: '한식', // 훈련병은 한식으로 분류된 메뉴만 먹음 (일품 제외)
    convenienceBrands: [], // 간편식 못 먹음
  },
  instructor: {
    label: '조교',
    restaurantKeyword: '훈련단',
    onlyCourseTxt: null,
    convenienceBrands: ['마이보글', 'T/O', '로카프랩'],
  },
  specialty: {
    label: '특기학교 및 진주 자대',
    restaurantKeyword: '정통학교',
    onlyCourseTxt: null,
    convenienceBrands: ['T/O(B)', 'T/O(A)', '셀프라면'],
  },
  candidate: {
    label: '부사관 및 장교 후보생',
    restaurantKeyword: '후보생',
    onlyCourseTxt: null,
    convenienceBrands: [], // 간편식 없음
  },
};
// 로카프랩은 예약 전용 시스템이라 일반 메뉴 API엔 절대 안 잡힘 -> 항상 안내용으로만 표시
const RESERVATION_ONLY_BRANDS = ['로카프랩'];

function getCategoryConfig(category) {
  return CATEGORY_CONFIG[category] || CATEGORY_CONFIG.instructor;
}

// ---------- 식단 (관리자 계정 한 번만 로그인, 모두에게 공유) ----------

const client = new WelstoryPlusClient({
  username: process.env.WELSTORY_USERNAME,
  password: process.env.WELSTORY_PASSWORD,
});

const restaurantByKeywordCache = new Map(); // 키워드 -> 식당 객체
let myRestaurantsCache = null;

async function findRestaurantByKeyword(keyword) {
  if (restaurantByKeywordCache.has(keyword)) return restaurantByKeywordCache.get(keyword);

  const getName = (r) => r.name ?? r.restaurantName ?? r.title ?? '';

  if (!myRestaurantsCache) {
    myRestaurantsCache = await client.getRestaurants();
  }
  let found = myRestaurantsCache.find((r) => getName(r).includes(keyword));

  // 내 목록(즐겨찾기)에 없으면 전체 검색해서 찾고, 조회 가능하도록 내 목록에 추가해봄
  if (!found) {
    try {
      const searched = await client.searchRestaurants(keyword);
      found = searched.find((r) => getName(r).includes(keyword)) ?? searched[0];
      if (found) {
        try {
          await client.addRestaurant(found.id);
          myRestaurantsCache = null; // 다음에 다시 불러오게 캐시 초기화
        } catch (e) {
          console.warn(`[findRestaurantByKeyword] addRestaurant 실패 (${keyword}):`, e.message);
        }
      }
    } catch (e) {
      console.warn(`[findRestaurantByKeyword] searchRestaurants 실패 (${keyword}):`, e.message);
    }
  }

  if (found) restaurantByKeywordCache.set(keyword, found);
  return found;
}

function todayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function parseNum(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

// 라이브러리의 getMenus()는 courseTxt(브랜드명 텍스트)와 subMenuTxt(반찬 목록 텍스트)를
// 버리고 내부적으로 다시 매핑해버려서, 원본 API(/api/meal)를 직접 불러와 우리가 그룹핑함.
async function fetchRawMenus(restaurant, date, mealTimeId) {
  const raw = await client.request(
    `/api/meal?menuDt=${date}&menuMealType=${mealTimeId}&restaurantCode=${restaurant.id}`,
    { headers: { Cookie: `cafeteriaActiveId=${restaurant.id}` } }
  );

  if (raw?.code !== undefined && raw.code !== 0) {
    console.warn(
      `[fetchRawMenus] 응답 코드 이상함: date=${date} mealTimeId=${mealTimeId} code=${raw.code} message=${raw.message}`
    );
  }

  const dishes = raw?.data?.mealList;
  if (!Array.isArray(dishes)) {
    console.warn(`[fetchRawMenus] mealList가 배열이 아님: date=${date} mealTimeId=${mealTimeId} raw=`, JSON.stringify(raw).slice(0, 500));
    return [];
  }

  const groups = new Map();
  for (const d of dishes) {
    const key = `${d.hallNo}-${d.menuCourseType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    const main = group.find((d) => d.typicalMenu === '메인' || d.typicalMenu === 'Y') ?? first;
    return {
      id: `${first.menuDt}-${first.restaurantCode}-${first.hallNo}-${first.menuCourseType}`,
      name: main.menuName,
      date: first.menuDt,
      mealTimeId: first.menuMealType,
      hallNo: first.hallNo,
      courseType: first.menuCourseType,
      courseTxt: first.courseTxt, // 브랜드/분류명 (예: 한식, 마이보글, T/O, 로카프랩)
      subMenuTxt: first.subMenuTxt, // "군대리아,양배추샐러드*케요네즈,..." 형태의 구성메뉴 텍스트
      components: group.map((d) => ({ name: d.menuName, kcal: parseNum(d.kcal) })),
      nutrition: {
        calories: parseNum(first.sumKcal),
        protein: parseNum(first.sumProtein),
        fat: parseNum(first.sumFat),
        sodium: parseNum(first.sumNa),
        sugar: parseNum(first.sumSugar),
      },
      imageUrl: first.photoUrl && first.photoCd ? first.photoUrl + first.photoCd : undefined,
    };
  });
}

app.get('/api/menu', async (req, res) => {
  try {
    const category = (req.query.category || 'instructor').toString();
    const config = getCategoryConfig(category);

    const restaurant = await findRestaurantByKeyword(config.restaurantKeyword);
    if (!restaurant) {
      return res.status(404).json({
        error: `"${config.restaurantKeyword}" 이름의 식당을 못 찾았어요.`,
      });
    }
    const targetDate = (req.query.date || todayYYYYMMDD()).toString();
    const mealTimes = await client.getMealTimes(restaurant);

    const meals = [];
    for (const mealTime of mealTimes) {
      let menus = await fetchRawMenus(restaurant, targetDate, mealTime.id ?? mealTime.mealTimeId);
      // 훈련병은 "한식"으로 분류된 것만 (일품/간편식 다 제외)
      if (config.onlyCourseTxt) {
        menus = menus.filter((m) => m.courseTxt === config.onlyCourseTxt);
      }
      meals.push({
        mealTime: mealTime.name ?? mealTime.mealTimeName ?? '식사',
        menus,
      });
    }
    res.json({
      date: targetDate,
      meals,
      convenienceBrands: config.convenienceBrands,
      reservationOnlyBrands: config.convenienceBrands.filter((b) => RESERVATION_ONLY_BRANDS.includes(b)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '식단을 불러오지 못했어요.' });
  }
});

app.get('/api/menu-detail', async (req, res) => {
  try {
    const { date, mealTimeId, hallNo, courseType, category } = req.query;
    if (!date || !mealTimeId || !hallNo || !courseType) {
      return res.status(400).json({ error: 'date, mealTimeId, hallNo, courseType가 모두 필요합니다.' });
    }
    const config = getCategoryConfig((category || 'instructor').toString());
    const restaurant = await findRestaurantByKeyword(config.restaurantKeyword);
    const [detailResult, nutrientResult] = await Promise.allSettled([
      client.getMenuDetail(restaurant, date, mealTimeId, hallNo, courseType),
      client.getMenuNutrientDetail(restaurant, date, mealTimeId, hallNo, courseType),
    ]);
    res.json({
      components: detailResult.status === 'fulfilled' ? detailResult.value : [],
      nutrient: nutrientResult.status === 'fulfilled' ? nutrientResult.value : [],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '상세 정보를 못 가져왔어요.' });
  }
});

app.use(express.static('public', { dotfiles: 'allow' }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`서버 실행중: http://localhost:${port}`);
});
