require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_TOKEN = process.env.OPENAI_TOKEN;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const WHITELIST = (process.env.WHITELIST || "").split(",");
const CACHE_EXPIRATION_TIME = 15 * 60 * 1000; // 15 минут

const botPermissionsCache = {};

const isAdvertisement = async (text) => {
    try {
        const response = await axios.post(OPENAI_URL, {
            "model": "gpt-3.5-turbo",
            temperature: 0,
            messages: [{ role: "user", content: `Is the following message a sort of any commercial (ad or job offer)?. Message text: ${text}` }],
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data.choices[0].message.content.trim().substr(0, 5) === 'Yes, ';
    } catch (error) {
        console.error('Error querying OpenAI:', error);
        return false;
    }
};

const canBotDeleteMessage = async (chatId, force = false) => {
    const now = Date.now();

    if (!force && botPermissionsCache[chatId] && (now - botPermissionsCache[chatId].timestamp) <= CACHE_EXPIRATION_TIME) {
        return botPermissionsCache[chatId].canDelete;
    }

    try {
        const chatMember = await bot.telegram.getChatMember(chatId, bot.botInfo.id);
        const canDelete = chatMember.can_delete_messages || false;

        botPermissionsCache[chatId] = {
            canDelete,
            timestamp: now,
        };
        return canDelete;
    } catch (error) {
        console.error('Error fetching bot permissions:', error);
        return false;
    }
}

const bot = new Telegraf(TELEGRAM_TOKEN);
let botUsername = 'unknown';


bot.on('text', async (ctx) => {
    try {
        const chatId = ctx.chat.id;

        if (WHITELIST.includes(chatId.toString()) && await isAdvertisement(ctx.message.text)) {
            const canDelete = await canBotDeleteMessage(chatId);

            if (canDelete) {
                await ctx.telegram.sendMessage(chatId, 'Удалить это сообщение?', {
                    reply_to_message_id: ctx.message.message_id,
                    reply_markup: {
                        inline_keyboard: [[{ text: 'Удалить', callback_data: 'delete_ad' }]]
                    }
                });
            } else {
                await ctx.telegram.sendMessage(chatId, 'У меня нет прав на удаление сообщений', {
                    reply_to_message_id: ctx.message.message_id
                });
            }
            return;
        }
        if (ctx.message.entities && ctx.message.entities.some(entity => 
            entity.type === 'mention' && 
            ctx.message.text.includes(botUsername))) {  // Проверка, что упоминание относится к имени вашего бота
                const canDelete = await canBotDeleteMessage(chatId, true); // использование force
                const isWhitelisted = WHITELIST.includes(chatId.toString());
                await ctx.telegram.sendMessage(chatId, `ID группы: ${chatId}\nМогу удалить сообщения: ${canDelete ? "Да" : "Нет"}\nГруппа в вайтлисте: ${isWhitelisted ? "Да" : "Нет"}`, {
                    reply_to_message_id: ctx.message.message_id
                });
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
});

bot.action('delete_ad', async (ctx) => {
    try {
        const canDelete = await canBotDeleteMessage(ctx.chat.id, true); 
        if (canDelete && ctx.callbackQuery.message.reply_to_message) {
            await ctx.deleteMessage(ctx.callbackQuery.message.reply_to_message.message_id);
            await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
        }
        await ctx.answerCbQuery();
    } catch (error) {
        console.error('Error in delete_ad action:', error);
    }
});


bot.telegram.getMe().then((botInfo) => {
    botUsername = botInfo.username;
    console.log(`Имя бота: ${botUsername}`);

    bot.launch();
});
