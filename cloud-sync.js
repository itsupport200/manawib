/* Shared online storage for Manawib. Requires Supabase anonymous auth and the RLS schema in supabase/schema.sql. */
(function () {
  'use strict';

  const url = window.MANAWIB_SUPABASE_URL || '';
  const key = window.MANAWIB_SUPABASE_KEY || '';
  const localEmployees = JSON.parse(JSON.stringify(employees));
  const localHolidays = JSON.parse(JSON.stringify(holidays));
  const oldSave = save;
  const oldSaveHolidays = saveHolidays;
  let client, user, employeeBaseline = new Map(), holidayBaseline = new Map();
  let syncQueue = Promise.resolve();
  let authListenerSet = false;

  const style = document.createElement('style');
  style.textContent = '.cloud-gate{position:fixed;inset:0;z-index:20;background:#f5f7f4;display:grid;place-items:center;padding:18px;direction:rtl;font-family:Tahoma,Arial,sans-serif;color:#20312d}.cloud-card{width:min(460px,100%);background:#fff;border:1px solid #e5ebe7;border-radius:18px;padding:24px;box-shadow:0 12px 36px #253c3010}.cloud-card h1{font-size:21px;margin:0 0 8px}.cloud-card p{font-size:14px;line-height:1.8;color:#71817b}.cloud-card label{display:block;font-size:13px;margin:12px 0 5px}.cloud-card input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #dce4de;border-radius:9px;font:inherit}.cloud-card button{border:0;border-radius:9px;padding:11px 15px;background:#16795b;color:white;font:inherit;cursor:pointer;margin-top:14px}.cloud-card button.secondary{background:#e9f4ee;color:#16795b;margin-right:6px}.cloud-card button:disabled{opacity:.55;cursor:wait}.cloud-error{color:#aa3936!important}.cloud-note{font-size:12px!important}.cloud-actions{display:flex;flex-wrap:wrap;gap:6px}.cloud-gate[hidden]{display:none}';
  document.head.appendChild(style);
  document.querySelector('.shell').style.display = 'none';
  const gate = document.createElement('main');
  gate.className = 'cloud-gate';
  document.body.appendChild(gate);

  function show(html) { gate.innerHTML = '<section class="cloud-card">' + html + '</section>'; }
  function message(text, error) {
    const el = document.getElementById('cloudMessage');
    if (el) { el.textContent = text; el.className = error ? 'cloud-error' : 'cloud-note'; }
  }
  function startApp() {
    document.body.classList.remove('cloud-required');
    document.querySelector('.shell').style.display = '';
    const localBadge = document.querySelector('.local');
    if (localBadge) localBadge.textContent = 'بيانات الفريق محفوظة على الإنترنت';
    gate.hidden = true;
    render();
    renderDetail();
    document.title = 'مناوب | إدارة الموظفين والشفتات';
  }
  function employeeRow(e) {
    return { id:e.id, name:e.name, number:e.number, phone:e.phone||'', start_date:e.startDate,
      leave_balance:Number(e.leaveBalance)||0, leave_used:e.leaveUsed||{}, credit_years:e.creditYears||[],
      accrual_anchor:e.accrualAnchor||null };
  }
  function employeeFromRow(r) {
    return { id:r.id, name:r.name, number:r.number, phone:r.phone||'', startDate:r.start_date,
      leaveBalance:Number(r.leave_balance)||0, leaveUsed:r.leave_used||{}, creditYears:r.credit_years||[],
      accrualAnchor:r.accrual_anchor||null };
  }
  function holidayRow(h) {
    return { id:h.id, name:h.name, start_date:h.start, end_date:h.end, source:h.source||'' };
  }
  function holidayFromRow(r) { return { id:r.id, name:r.name, start:r.start_date, end:r.end_date, source:r.source||'' }; }
  async function syncTable(table, current, baseline, toRow) {
    const currentMap = new Map(current.map(item => [item.id, item]));
    const changed = [];
    for (const item of current) {
      const row = toRow(item), before = baseline.get(item.id);
      if (!before || JSON.stringify(row) !== JSON.stringify(before)) changed.push(row);
    }
    const removed = [...baseline.keys()].filter(id => !currentMap.has(id));
    if (changed.length) {
      const { error } = await client.from(table).upsert(changed, { onConflict:'id' });
      if (error) throw error;
    }
    if (removed.length) {
      const { error } = await client.from(table).delete().in('id', removed);
      if (error) throw error;
    }
    baseline.clear();
    current.forEach(item => baseline.set(item.id, toRow(item)));
  }
  function queueSync(table, items, baseline, toRow) {
    syncQueue = syncQueue.then(() => syncTable(table, items, baseline, toRow)).catch(err => {
      console.error('Manawib cloud sync failed', err);
      toast('تعذر حفظ التغيير في قاعدة البيانات. تحقق من الاتصال ثم أعد المحاولة.');
    });
  }
  save = function () {
    oldSave();
    if (user) queueSync('employees', employees, employeeBaseline, employeeRow);
  };
  saveHolidays = function () {
    oldSaveHolidays();
    if (user) queueSync('holidays', holidays, holidayBaseline, holidayRow);
  };

  async function loadCloud(importLocal) {
    message('جارٍ تحميل بيانات الفريق…');
    const [employeeResult, holidayResult] = await Promise.all([
      client.from('employees').select('*').order('name'),
      client.from('holidays').select('*').order('start_date')
    ]);
    if (employeeResult.error) throw employeeResult.error;
    if (holidayResult.error) throw holidayResult.error;
    const cloudEmployees = employeeResult.data.map(employeeFromRow);
    const cloudHolidays = holidayResult.data.map(holidayFromRow);

    if (importLocal) {
      employees = localEmployees;
      holidays = cloudHolidays.length ? cloudHolidays : localHolidays;
      await Promise.all([
        syncTable('employees', employees, employeeBaseline, employeeRow),
        syncTable('holidays', holidays, holidayBaseline, holidayRow)
      ]);
    } else {
      employees = cloudEmployees;
      holidays = cloudHolidays.length ? cloudHolidays : officialHolidays();
      employeeBaseline = new Map(employees.map(e => [e.id, employeeRow(e)]));
      holidayBaseline = new Map(cloudHolidays.map(h => [h.id, holidayRow(h)]));
      if (!cloudHolidays.length && holidays.length) {
        await syncTable('holidays', holidays, holidayBaseline, holidayRow);
      }
    }
    selectedId = employees[0]?.id || null;
    oldSave(); oldSaveHolidays();
    startApp();
  }

  async function signedIn(session) {
    user = session.user;
    try {
      const { data, error } = await client.from('employees').select('id').limit(1);
      if (error) throw error;
      if (!data.length && localEmployees.length) {
        show('<h1>قاعدة الفريق جاهزة</h1><p>وجدت بيانات على هذا الجهاز. اختر هل تنقل بيانات الموظفين والعطلات إلى قاعدة الفريق المشتركة، أم تبدأ بقاعدة فارغة. لن تُرفع البيانات إلا بعد اختيارك.</p><p id="cloudMessage" class="cloud-note"></p><div class="cloud-actions"><button id="importLocal">نقل بيانات هذا الجهاز إلى الفريق</button><button class="secondary" id="startEmpty">ابدأ بدون نقل</button></div>');
        document.getElementById('importLocal').onclick = () => loadCloud(true).catch(e => message(e.message, true));
        document.getElementById('startEmpty').onclick = () => loadCloud(false).catch(e => message(e.message, true));
      } else {
        await loadCloud(false);
      }
    } catch (e) {
      show('<h1>تعذر الوصول لقاعدة البيانات</h1><p id="cloudMessage" class="cloud-error"></p><button id="retryCloud">إعادة المحاولة</button><button class="secondary" id="signOut">تسجيل الخروج</button>');
      message(e.message || 'تحقق من إعداد الجداول والصلاحيات.', true);
      document.getElementById('retryCloud').onclick = () => signedIn({user});
      document.getElementById('signOut').onclick = () => client.auth.signOut();
    }
  }

  async function boot() {
    if (!url.startsWith('https://') || !key || key.includes('PASTE_')) {
      show('<h1>قاعدة الفريق لم تُربط بعد</h1><p>يلزم إدخال Project URL وPublishable key في <code>cloud-config.js</code> بعد إنشاء مشروع Supabase وتشغيل <code>schema.sql</code>. لم يتم إرسال البيانات المحلية إلى أي مكان.</p><p id="cloudMessage" class="cloud-note">بيانات هذا الجهاز باقية محفوظة محليًا.</p>');
      return;
    }
    if (!window.supabase?.createClient) {
      show('<h1>تعذر تحميل خدمة قاعدة البيانات</h1><p id="cloudMessage" class="cloud-error">تحقق من اتصال الإنترنت ثم حدّث الصفحة.</p>');
      return;
    }
    client = window.supabase.createClient(url, key, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
    if (!authListenerSet) {
      authListenerSet = true;
      client.auth.onAuthStateChange((event, sessionNow) => {
        if (event === 'SIGNED_OUT' || (!sessionNow && user)) { user = null; document.querySelector('.shell').style.display='none'; gate.hidden=false; document.body.classList.add('cloud-required'); boot(); }
      });
    }
    const { data:{session}, error } = await client.auth.getSession();
    if (error) { show('<h1>تعذر بدء الاتصال</h1><p id="cloudMessage" class="cloud-error"></p>'); message(error.message,true); return; }
    if (session) { await signedIn(session); return; }
    show('<h1>جارٍ فتح مناوِب</h1><p id="cloudMessage" class="cloud-note">يتم الاتصال بقاعدة الفريق المشتركة…</p>');
    const { data, error:anonymousError } = await client.auth.signInAnonymously();
    if (anonymousError) {
      show('<h1>تعذر الاتصال بقاعدة الفريق</h1><p id="cloudMessage" class="cloud-error"></p><p class="cloud-note">يلزم تفعيل الدخول المجهول في إعدادات Supabase للمشروع.</p><button id="retryCloud">إعادة المحاولة</button>');
      message(anonymousError.message || 'تعذر بدء جلسة الاتصال.', true);
      document.getElementById('retryCloud').onclick = () => boot().catch(e => message(e.message, true));
      return;
    }
    await signedIn(data.session);
  }
  boot().catch(e => { show('<h1>تعذر الاتصال</h1><p id="cloudMessage" class="cloud-error"></p>'); message(e.message || 'تحقق من إعداد Supabase.', true); });
})();
