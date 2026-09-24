// ==========================================
// 1. КОНФИГУРАЦИЯ И ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ==========================================
// Замените этот URL на адрес вашего сервера на Render после деплоя бэкенда
const BACKEND_URL = 'https://your-backend-domain.onrender.com';

const tg = window.Telegram?.WebApp;
let telegramUser = null;
let currentSlideIndex = 1;
let uploadedImageElement = null;

// Состояние подписки пользователя по умолчанию
let userSubscription = {
  plan: 'FREE',
  packsLeft: 1,
  invitedCount: 0,
  discountSum: 0
};

// Хранилище сгенерированного текста от ИИ для слайдов
let generatedAiData = {
  title: '',
  description: '',
  keywords: '',
  slidesText: {
    1: { badge: 'ХИТ ПРОДАЖ', subtitle: '' },
    2: { title: '📐 Размеры и Габариты', details: ['Высота: 120 мм', 'Ширина: 65 мм', 'Вес: 85 г'] },
    3: { title: '📦 Комплектация', details: ['1х Основное устройство', '1х Кабель Type-C', '1х Инструкция'] },
    4: { title: '⭐ Главные Преимущества', details: ['Быстрая зарядка', 'Эргономичный дизайн', 'Гарантия качества'] },
    5: { title: '⚖️ Сравнение С Аналогами', details: ['Наш продукт: Премиум материалы', 'Аналоги: Дешевый пластик'] }
  }
};

// ==========================================
// 2. ИНИЦИАЛИЗАЦИЯ TELEGRAM WEB APP
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  if (tg) {
    tg.ready();
    tg.expand();
    telegramUser = tg.initDataUnsafe?.user;
  }

  syncUserSubscription();
  renderVisualCard();
});

// Синхронизация статуса подписки и лимитов с сервером
async function syncUserSubscription() {
  if (!telegramUser) {
    updateLimitDisplay();
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/user-status/${telegramUser.id}`);
    if (res.ok) {
      const data = await res.json();
      userSubscription.plan = data.plan || 'FREE';
      userSubscription.packsLeft = data.packsLeft ?? 1;
      userSubscription.invitedCount = data.invitedCount || 0;
      
      // Расчет скидки ($1 за друга, максимум $2)
      const discount = Math.min(userSubscription.invitedCount, 2);
      userSubscription.discountSum = discount;

      updateLimitDisplay();
      updatePaywallPrices();
    }
  } catch (error) {
    console.error('Ошибка синхронизации данных пользователя:', error);
  }
}

function updateLimitDisplay() {
  const counter = document.getElementById('limitCounter');
  if (!counter) return;

  if (userSubscription.plan === 'VIP') {
    counter.innerHTML = 'Тариф: <strong>VIP (∞)</strong>';
  } else {
    counter.innerHTML = `Паков осталось: <strong>${userSubscription.packsLeft}</strong>`;
  }
}

// ==========================================
// 3. ОБРАБОТКА ФОРМЫ И ГЕНЕРАЦИЯ ИИ (GEMINI)
// ==========================================
async function generateContent() {
  const name = document.getElementById('productName').value.trim();
  const price = document.getElementById('productPrice').value.trim();
  const details = document.getElementById('productDetails').value.trim();

  if (!name) {
    alert('Пожалуйста, укажите название товара!');
    return;
  }

  // Проверка лимитов
  if (userSubscription.plan !== 'VIP' && userSubscription.packsLeft <= 0) {
    openPaywall();
    return;
  }

  const btn = document.querySelector('.btn-primary');
  const originalText = btn.innerHTML;
  btn.innerText = '⏳ Генерируем пак...';
  btn.disabled = true;

  try {
    // Вызов API сервера для получения данных от Gemini ИИ
    const response = await fetch(`${BACKEND_URL}/api/generate-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUser?.id,
        productName: name,
        price: price,
        details: details
      })
    });

    if (!response.ok) {
      throw new Error('Ошибка генерации на сервере');
    }

    const data = await response.json();
    
    // Обновляем текстовые блоки на странице
    document.getElementById('resDescription').innerText = data.description || 'Описание успешно сгенерировано.';
    document.getElementById('resKeywords').innerText = data.keywords || '#товар #маркетплейс';

    // Сохраняем распарсенные данные для Canvas
    if (data.slidesData) {
      generatedAiData.slidesText = data.slidesData;
    }

    // Уменьшаем лимит на клиенте
    if (userSubscription.plan !== 'VIP') {
      userSubscription.packsLeft--;
      updateLimitDisplay();
    }

    renderVisualCard();
    alert('✨ Пак карточки успешно сгенерирован!');

  } catch (error) {
    console.error('Ошибка генерации:', error);
    // Фолбэк локальной генерации, если сервер недоступен
    fallbackLocalGeneration(name, price, details);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function fallbackLocalGeneration(name, price, details) {
  document.getElementById('resDescription').innerText = 
    `🔥 ${name} — отличный выбор для покупки!\n\n` +
    `Основные преимущества:\n${details || 'Высокое качество и надежность.'}\n\n` +
    `Заказывайте прямо сейчас по лучшей цене: ${price || 'Договорная'}!`;

  document.getElementById('resKeywords').innerText = `#${name.toLowerCase().replace(/\s+/g, ' #')} #узбекистан #скидки`;

  renderVisualCard();
}

// ==========================================
// 4. ЗАГРУЗКА ИЗОБРАЖЕНИЙ
// ==========================================
document.getElementById('imageUploader').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        uploadedImageElement = img;
        renderVisualCard();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }
});

// ==========================================
// 5. РЕНДЕРИНГ ХОЛСТА (CANVAS 1:1 / 3:4)
// ==========================================
function selectSlide(slideNum) {
  currentSlideIndex = slideNum;
  document.querySelectorAll('.slide-selector-group button').forEach((btn, idx) => {
    btn.classList.toggle('active', idx + 1 === slideNum);
  });
  renderVisualCard();
}

function renderVisualCard() {
  const canvas = document.getElementById('cardCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const bgTheme = document.getElementById('bgStudioTheme').value;
  const title = document.getElementById('productName').value || 'Название товара';
  const price = document.getElementById('productPrice').value || '199 000 сум';

  const W = canvas.width;
  const H = canvas.height;

  // 1. Очистка и отрисовка фона
  drawBackground(ctx, bgTheme, W, H);

  // 2. Отрисовка фото товара с тенью
  if (uploadedImageElement) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;

    const aspect = uploadedImageElement.width / uploadedImageElement.height;
    let drawW = W * 0.55;
    let drawH = drawW / aspect;
    
    if (drawH > H * 0.45) {
      drawH = H * 0.45;
      drawW = drawH * aspect;
    }

    ctx.drawImage(uploadedImageElement, (W - drawW) / 2, H * 0.25, drawW, drawH);
    ctx.restore();
  }

  // 3. Отрисовка контента в зависимости от выбранного слайда
  const isLight = bgTheme === 'clean';
  ctx.fillStyle = isLight ? '#0f172a' : '#ffffff';
  ctx.textAlign = 'center';

  switch (currentSlideIndex) {
    case 1: // Главный слайд
      ctx.font = 'bold 42px sans-serif';
      ctx.fillText(title, W / 2, H * 0.08);

      // Плашка цены
      ctx.fillStyle = '#6366f1';
      ctx.beginPath();
      ctx.roundRect(W / 2 - 140, H * 0.12, 280, 65, 16);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(price, W / 2, H * 0.12 + 43);
      break;

    case 2: // Размеры
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('📐 Размеры и Габариты', W / 2, H * 0.08);
      drawInfoList(ctx, generatedAiData.slidesText[2].details, W, H, isLight);
      break;

    case 3: // Комплект
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('📦 Комплектация', W / 2, H * 0.08);
      drawInfoList(ctx, generatedAiData.slidesText[3].details, W, H, isLight);
      break;

    case 4: // Преимущества
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('⭐ Преимущества', W / 2, H * 0.08);
      drawInfoList(ctx, generatedAiData.slidesText[4].details, W, H, isLight);
      break;

    case 5: // Сравнение
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText('⚖️ Сравнение С Аналогами', W / 2, H * 0.08);
      drawInfoList(ctx, generatedAiData.slidesText[5].details, W, H, isLight);
      break;
  }
}

// Вспомогательная функция отрисовки фонов
function drawBackground(ctx, theme, W, H) {
  if (theme === 'dark') {
    let grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
  } else if (theme === 'neon') {
    let grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#3b0764');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
  } else if (theme === 'marble') {
    let grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#1e293b');
    grad.addColorStop(1, '#0f172a');
    ctx.fillStyle = grad;
  } else {
    // clean
    ctx.fillStyle = '#f8fafc';
  }
  ctx.fillRect(0, 0, W, H);
}

// Вспомогательная функция отрисовки списка пунктов на слайде
function drawInfoList(ctx, items, W, H, isLight) {
  if (!items || !items.length) return;
  
  let startY = H * 0.75;
  ctx.font = '24px sans-serif';
  ctx.fillStyle = isLight ? '#334155' : '#e2e8f0';

  items.forEach((item, index) => {
    ctx.fillText(item, W / 2, startY + (index * 45));
  });
}

function downloadCurrentSlide() {
  const canvas = document.getElementById('cardCanvas');
  const link = document.createElement('a');
  link.download = `slide_${currentSlideIndex}_card.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

// ==========================================
// 6. МОДАЛЬНОЕ ОКНО И ОПЛАТА (PAYWALL)
// ==========================================
function openPaywall() {
  document.getElementById('paywallModal').style.display = 'flex';
}

function closePaywall() {
  document.getElementById('paywallModal').style.display = 'none';
}

function updatePaywallPrices() {
  const discount = userSubscription.discountSum;
  document.getElementById('invitedCount').innerText = userSubscription.invitedCount;
  document.getElementById('discountVal').innerText = discount;

  // Динамический перерасчет стоимости со скидкой
  const proPrice = Math.max(3, 5 - discount);
  const vipPrice = Math.max(8, 10 - discount);

  document.getElementById('proPriceText').innerText = `$${proPrice}`;
  document.getElementById('vipPriceText').innerText = `$${vipPrice}`;
}

// Оплата через Telegram Stars (XTR)
async function payWithStars(plan) {
  if (!telegramUser) {
    alert('Пожалуйста, откройте Web App через Telegram бота!');
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/create-stars-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId: telegramUser.id,
        plan: plan
      })
    });

    const data = await res.json();
    if (data.invoiceUrl) {
      window.Telegram.WebApp.openInvoice(data.invoiceUrl, (status) => {
        if (status === 'paid') {
          alert(`🎉 Поздравляем! Тариф ${plan} успешно активирован!`);
          closePaywall();
          syncUserSubscription();
        }
      });
    }
  } catch (error) {
    console.error('Ошибка оплаты Stars:', error);
    alert('Не удалось сформировать счет на оплату.');
  }
}

// Оплата через Click / Payme (перенаправление в бота)
function selectPlan(plan) {
  if (tg) {
    tg.sendData(JSON.stringify({ action: 'BUY_PLAN', plan: plan }));
    tg.close();
  } else {
    alert(`Переход к оплате тарифа ${plan}`);
  }
}
