/* ============================================================
   행복콜택시 통합관리시스템 - API Bridge
   ------------------------------------------------------------
   GAS 웹앱을 "데이터 API 서버"로만 쓰고, 화면(Index.html / Admin.html)은
   GitHub Pages 등 별도 정적 호스팅에서 서빙할 때 사용하는 연결 스크립트입니다.

   기존 화면 코드는 전부 google.script.run.함수명(...) 형태로 작성되어 있으므로,
   이 스크립트는 google.script.run 을 동일한 인터페이스로 다시 만들어
   내부적으로 fetch() 요청으로 바꿔줍니다.
   → 즉, Index.html / Admin.html 의 나머지 코드는 전혀 수정할 필요가 없습니다.

   사용법
   ------
   1) 이 파일보다 "먼저" HCAB_API_URL 을 지정하세요. (Index.html / Admin.html 상단 참고)
        <script>window.HCAB_API_URL = "https://script.google.com/macros/s/AKfycb.../exec";</script>
        <script src="api-bridge.js"></script>
   2) 나머지 코드는 그대로 두면 됩니다. (google.script.run.getMenus() 등)
   ============================================================ */
(function (global) {
  'use strict';

  var API_URL = global.HCAB_API_URL;

  if (!API_URL) {
    console.error(
      '[api-bridge] HCAB_API_URL이 설정되지 않았습니다. ' +
      'api-bridge.js를 불러오기 전에 window.HCAB_API_URL을 지정하세요.'
    );
  }

  function assign(base, extra) {
    var out = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (var k2 in extra) if (Object.prototype.hasOwnProperty.call(extra, k2)) out[k2] = extra[k2];
    return out;
  }

  function callServer(fnName, args, handlers) {
    fetch(API_URL, {
      method: 'POST',
      // Content-Type을 명시하지 않아야 브라우저가 "simple request"로 처리해
      // Apps Script 웹앱에서 CORS preflight(OPTIONS) 없이 바로 응답받을 수 있습니다.
      body: JSON.stringify({ fn: fnName, args: args })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('서버 응답 오류 (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        if (data && data.error) {
          if (handlers.failure) handlers.failure({ message: data.error });
          else console.error('[api-bridge] 서버 오류 - ' + fnName + ':', data.error);
        } else {
          if (handlers.success) handlers.success(data ? data.result : undefined, handlers.userObject);
        }
      })
      .catch(function (err) {
        if (handlers.failure) handlers.failure({ message: err.message });
        else console.error('[api-bridge] 네트워크 오류 - ' + fnName + ':', err);
      });
  }

  function createRunner(handlers) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) { return createRunner(assign(handlers, { success: cb })); };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) { return createRunner(assign(handlers, { failure: cb })); };
        }
        if (prop === 'withUserObject') {
          return function (obj) { return createRunner(assign(handlers, { userObject: obj })); };
        }
        // 그 외 이름은 모두 GAS 서버 함수 호출로 간주합니다.
        return function () {
          var args = Array.prototype.slice.call(arguments);
          callServer(String(prop), args, handlers);
        };
      }
    });
  }

  global.google = global.google || {};
  global.google.script = global.google.script || {};
  global.google.script.run = createRunner({});
})(window);
