
async function main ({ page, args }) {
    const keyword = (args && args[0]) || '影刀';

    await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded', timeout: 15000 });

    const input = page.getByRole('textbox').first();
    await input.fill(keyword);

    await page.getByRole('button', { name: '百度一下' }).click();

    await page.waitForSelector('#content_left h3', { timeout: 15000 });
    await page.waitForTimeout(1000);

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
  }
