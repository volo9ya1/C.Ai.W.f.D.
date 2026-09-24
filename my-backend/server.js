require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');

// ==========================================
// 1. ИНИЦИАЛИЗАЦИЯ И КОНФИГУРАЦИЯ
// ==========================================
const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://your-frontend-domain.onrender.com';

// Инициализация Telegram бота
const bot = new Telegraf(BOT_TOKEN);

// Инициализация Google Gemini AI SDK
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Простейшая база данных в памяти (In-Memory DB)
// В продакшене рекомендуется использовать PostgreSQL / MongoDB / Redis
const usersDB = {};

// Вспомогательная функция получения/создания профиля
function getUserProfile(telegramId, username = '') {
  if (!usersDB[telegramId]) {
    usersDB[telegramId] = {
      id: telegramId,
      username: username,
      plan: 'FREE',        // 'FREE', 'PRO', 'VIP'
      packsLeft: 1,        // Остаток генераций
      invitedCount: 0,     // Число приглашенных друзей
      invitedBy: null      // Кто пригласил
    };
  }
  return usersDB[telegramId];
}

// ==========================================
// 2. ЛОГИКА TELEGRAM БОТА (TELEGRAF)
// ==========================================

// Команда /start (с поддержкой реферальных ссылок)
bot.start((ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || '';
  const startPayload = ctx.payload; // Аргументы реферальной ссылки

  const user = getUserProfile(telegramId, username);

  // Обработка реферального кода (например: t.me/bot?start=ref_12345)
  if (startPayload && startPayload.startsWith('ref_')) {
    const referrerId = startPayload.replace('ref_', '');
    if (referrerId !== String(telegramId) && !user.invitedBy) {
      user.invitedBy = referrerId;
      const referrer = usersDB[referrerId];
      if (referrer) {
        referrer.invitedCount = (referrer.invitedCount || 0) + 1;
      }
    }
  }

  const discountSum = Math.min(user.invitedCount, 2) * 12500; // Пример скидки в сумах

  ctx.reply(
    `👋 Привет, ${ctx.from.first_name}!\n\n` +
    `🚀 Добро пожаловать в **E-Commerce AI Combain** — твой персональный генератор карточек товаров для маркетплейсов!\n\n` +
    `📊 **Твой текущий статус:**\n` +
    `• Тариф: **${user.plan}**\n` +
    `• Осталось генераций: **${user.plan === 'VIP' ? 'Безлимит (∞)' : user.packsLeft}**\n` +
    `• Приглашено друзей: **${user.invitedCount}** (Скидка: ${discountSum.toLocaleString()} сум)\n\n` +
    `Нажми кнопку ниже, чтобы открыть веб-приложение:`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('✨ Открыть AI Combain', FRONTEND_URL)],
      [Markup.button.callback('💳 Управление тарифами', 'SHOW_TARIFS')],
      [Markup.button.callback('🎁 Реферальная ссылка', 'SHOW_REF')]
    ])
  );
});

// Меню тарифов
bot.action('SHOW_TARIFS', (ctx) => {
  const telegramId = ctx.from.id;
  const user = getUserProfile(telegramId);
  const discountSum = Math.min(user.invitedCount, 2) * 12500;
  
  const proPrice = Math.max(37500, 62500 - discountSum);
  const vipPrice = Math.max(100000, 125000 - discountSum);

  ctx.reply(
    `👑 **Выбор тарифного плана**\n\n` +
    `⭐ **PRO Plan** (5-7 паков в день)\n` +
    `└ Цена: **${proPrice.toLocaleString()} сум / мес**\n\n` +
    `🔥 **VIP Unlim** (Безлимит ∞)\n` +
    `└ Цена: **${vipPrice.toLocaleString()} сум / мес**\n\n` +
    `💡 *Скидка за рефералов применяется автоматически.*`,
    Markup.inlineKeyboard([
      [Markup.button.url('💳 Купить PRO (Click)', `https://my.click.uz/services/pay?service_id=${process.env.CLICK_SERVICE_ID \vert{}\vert{} '0'}&merchant_id=${process.env.CLICK_MERCHANT_ID || '0'}&amount=${proPrice}&transaction_param=${telegramId}_PRO`)],
      [Markup.button.url('💳 Купить VIP (Click)', `https://my.click.uz/services/pay?service_id=${process.env.CLICK_SERVICE_ID \vert{}\vert{} '0'}&merchant_id=${process.env.CLICK_MERCHANT_ID || '0'}&amount=${vipPrice}&transaction_param=${telegramId}_VIP`)],
      [Markup.button.callback('« Назад', 'BACK_TO_MAIN')]
    ])
  );
});

// Показ реферальной ссылки
bot.action('SHOW_REF', (ctx) => {
  const telegramId = ctx.from.id;
  const botUsername = ctx.botInfo.username;
  const refLink = `https://t.me/${botUsername}?start=ref_${telegramId}`;

  ctx.reply(
    `🎁 **Реферальная программа**\n\n` +
    `Делись ссылкой с друзьями и получай скидку на тарифы PRO и VIP!\n` +
    `Скидка $1 (~12 500 сум) за каждого друга, максимум $2.\n\n` +
    `🔗 Твоя ссылка:\n\`${refLink}\``,
    { parse_mode: 'Markdown' }
  );
});

bot.action('BACK_TO_MAIN', (ctx) => {
  ctx.deleteMessage().catch(() => {});
  ctx.reply('Используйте /start для вызова главного меню.');
});

// Подтверждение оплаты через Telegram Stars
bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on('successful_payment', (ctx) => {
  const payload = ctx.message.successful_payment.invoice_payload;
  const [telegramId, plan] = payload.split('_');

  const user = getUserProfile(telegramId);
  user.plan = plan;
  user.packsLeft = plan === 'VIP' ? 99999 : 7;

  ctx.reply(`🎉 Оплата прошла успешно! Ваш тариф обновлен до **${plan}**.`);
});

// ==========================================
// 3. API ЭНДПОИНТЫ ДЛЯ ФРОНТЕНДА (EXPRESS)
// ==========================================

// Получение статуса пользователя
app.get('/api/user-status/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  const user = getUserProfile(telegramId);
  res.json({
    plan: user.plan,
    packsLeft: user.packsLeft,
    invitedCount: user.invitedCount
  });
});

// Генерация инфографики и SEO текста с помощью Gemini AI
app.post('/api/generate-pack', async (req, res) => {
  const { telegramId, productName, price, details } = req.body;

  if (!productName) {
    return res.status(400).json({ error: 'Название товара обязательно' });
  }

  // Проверка лимитов пользователя (если передавали telegramId)
  if (telegramId) {
    const user = getUserProfile(telegramId);
    if (user.plan !== 'VIP' && user.packsLeft <= 0) {
      return res.status(403).json({ error: 'Превышен лимит генераций. Обновите тариф!' });
    }
  }

  try {
    const prompt = `
Ты — эксперт по e-commerce маркетингу и SEO для маркетплейсов (Uzum, Wildberries, Ozon).
Сгенерируй продающий контент для товара:
- Название: "${productName}"
- Цена: "${price || 'Не указана'}"
- Доп. детали: "${details || 'Нет'}"

Верни ответ СТРОГО в формате JSON без кавычек markdown \`\`\`json:
{
  "description": "Продающее SEO описание товара с эмодзи",
  "keywords": "Поисковые теги через решетку #тег1 #тег2",
  "slidesData": {
    "1": { "badge": "ХИТ ПРОДАЖ", "subtitle": "Короткий подзаголовок" },
    "2": { "title": "📐 Размеры и Габариты", "details": ["Пункт 1", "Пункт 2", "Пункт 3"] },
    "3": { "title": "📦 Комплектация", "details": ["Пункт 1", "Пункт 2", "Пункт 3"] },
    "4": { "title": "⭐ Главные Преимущества", "details": ["Пункт 1", "Пункт 2", "Пункт 3"] },
    "5": { "title": "⚖️ Сравнение С Аналогами", "details": ["Наш товар: Премиум качество", "Аналоги: Быстро ломается"] }
  }
}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    });

    let rawText = response.text.trim();
    // Очистка от возможных символов форматирования markdown
    rawText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '');

    const parsedData = JSON.parse(rawText);

    // Списываем лимит при успешной генерации
    if (telegramId) {
      const user = getUserProfile(telegramId);
      if (user.plan !== 'VIP' && user.packsLeft > 0) {
        user.packsLeft--;
      }
    }

    res.json(parsedData);

  } catch (error) {
    console.error('Ошибка Gemini AI:', error);
    res.status(500).json({ error: 'Ошибка генерации контента через ИИ' });
  }
});

// Выставление счета для Telegram Stars
app.post('/api/create-stars-invoice', async (req, res) => {
  const { telegramId, plan } = req.body;
  const starsAmount = plan === 'VIP' ? 500 : 250;

  try {
    const invoiceUrl = await bot.telegram.createInvoiceLink({
      title: `Подписка ${plan}`,
      description: `Активация тарифа ${plan} в E-Commerce AI Combain на 30 дней`,
      payload: `${telegramId}_${plan}`,
      provider_token: "", // Для Telegram Stars оставляем пустым
      currency: "XTR",
      prices: [{ label: `Тариф ${plan}`, amount: starsAmount }]
    });

    res.json({ success: true, invoiceUrl });
  } catch (error) {
    console.error('Ошибка выписки счета Stars:', error);
    res.status(500).json({ error: 'Не удалось выписать счет Stars' });
  }
});

// Проверка работоспособности сервера (Health check)
app.get('/health', (req, res) => {
  res.send('Server is healthy and running!');
});

// Запуск бота и сервера
bot.launch().then(() => {
  console.log('🤖 Telegram бот успешно запущен');
}).catch((err) => {
  console.error('Ошибка запуска Telegram бота:', err);
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
