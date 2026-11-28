/** ヘルプとページ上部への移動。createではDOMに触れず、setupでイベントを登録する。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubHelp = api;
})(typeof window !== 'undefined' ? window : globalThis, function create() {
  'use strict';
  const setupTutorialModal = async () => {
    const modal = document.getElementById('tutorial-modal');
    const btn = document.getElementById('tutorial-btn');
    const closeButton = document.getElementById('close-tutorial');
    const body = document.getElementById('tutorial-body');

    if (btn && modal && body) {
      // JSONからデータを読み込んでHTMLを生成
      try {
        const res = await fetch('tutorial.json');
        if (res.ok) {
          const data = await res.json();
          body.innerHTML = `
            <h1>${data.title}</h1>
            <p>${data.intro}</p>
            ${data.sections
              .map(
                (s) => `
              <div class="tutorial-section">
                <h3>${s.heading}</h3>
                ${s.list ? `<ul>${s.list.map((item) => `<li>${item}</li>`).join('')}</ul>` : ''}
                ${s.text ? `<p>${s.text}</p>` : ''}
              </div>
            `,
              )
              .join('')}
            <hr>
            <div class="disclaimer-box">
              <p><strong>${data.disclaimer.heading}</strong></p>
              <p style="font-size: 0.85em; color: #666;">${data.disclaimer.text}</p>
            </div>
          `;
        } else {
          body.innerHTML = '<p>使い方の読み込みに失敗しました。</p>';
        }
      } catch (e) {
        console.error('Tutorial load error:', e);
        body.innerHTML = '<p>使い方の読み込みに失敗しました。</p>';
      }

      const closeTutorial = () => {
        modal.style.display = 'none';
        btn.focus();
      };

      btn.onclick = () => {
        modal.style.display = 'block';
        closeButton?.focus();
      };

      // ×ボタンのイベント
      if (closeButton) closeButton.onclick = closeTutorial;

      // モーダル外クリックで閉じる
      modal.onclick = (event) => {
        if (event.target === modal) closeTutorial();
      };

      // Escキーで閉じる（アクセシビリティ対応）
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
          closeTutorial();
        }
      });
    }
  };

  const setupBackToTopButton = () => {
    const button = document.getElementById('back-to-top-btn');
    if (!button) return;

    button.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };
  // 固定ヘッダー（sticky-controls）の実高さをCSS変数に反映し、マイ履修列の
  // sticky位置（top）と高さ上限がヘッダーに隠れないようにする。幅や改行に
  // よって変わるため、実測値を使い、リサイズのたびに更新する。
  const setupStickyControlsOffset = () => {
    const header = document.getElementById('sticky-controls');
    if (!header) return;
    const update = () => {
      const height = Math.ceil(header.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--sticky-controls-height', `${height}px`);
    };
    update();
    window.addEventListener('resize', update);
  };
  return { setupTutorialModal, setupBackToTopButton, setupStickyControlsOffset };
});
