const keyword = (args && args[0]) || '影刀';

await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded', timeout: 15000 });

// 新版百度搜索框是可见的 textbox（非 #kw）
const input = page.getByRole('textbox').first();
await input.fill(keyword);

// 点击"百度一下"按钮
await page.getByRole('button', { name: '百度一下' }).click();

// 等待搜索结果加载
await page.waitForSelector('#content_left h3', { timeout: 15000 });
await page.waitForTimeout(1000);

// 抓取搜索结果
const results = await page.$$eval('#content_left .c-container', nodes => {
  return nodes.slice(0, 10).map((el, i) => {
    const titleEl = el.querySelector('h3 a') || el.querySelector('h3');
    const descEl = el.querySelector('.content-right_8Zs40')
      || el.querySelector('.c-abstract')
      || el.querySelector('span[class*="content"]')
      || el.querySelector('p');
    return {
      rank: i + 1,
      title: titleEl ? titleEl.textContent.trim() : '',
      url: titleEl && titleEl.href ? titleEl.href : '',
      desc: descEl ? descEl.textContent.trim().slice(0, 120) : '',
    };
  }).filter(r => r.title);
});

return JSON.stringify(results, null, 2);
