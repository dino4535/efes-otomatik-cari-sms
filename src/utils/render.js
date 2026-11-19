'use strict';

const path = require('node:path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '..', 'views');

async function renderPage(res, view, locals = {}) {
  const layout = locals.layout || (res.locals.currentUser ? 'layout' : 'layout-auth');
  const data = { ...res.locals, ...locals };
  const body = await ejs.renderFile(path.join(viewsDir, `${view}.ejs`), data);
  return res.render(layout, { ...data, body, layout: undefined });
}

module.exports = { renderPage };
