// Enhancements for carried leave balances, weekday labels, and Omani public holidays.
(function() {
  // Leave balance accrual and forecast calendar.
  const form = document.getElementById('employeeForm');
  const formFields = form.querySelector('.fields');
  const balanceWrap = document.createElement('div');
  balanceWrap.className = 'field full';
  balanceWrap.innerHTML = '<label for="leaveBalanceInput">الرصيد الحالي للإجازة السنوية (يوم) *</label><input id="leaveBalanceInput" type="number" min="0" step="0.5" required value="30"><small style="color:var(--muted)">أدخل الرصيد المتوفر حالياً شاملاً الأيام المرحلة من السنوات السابقة.</small>';
  formFields.appendChild(balanceWrap);
  const balanceDateWrap = document.createElement('div');
  balanceDateWrap.className = 'field full';
  balanceDateWrap.innerHTML = '<label for="balanceDateInput">تاريخ الرصيد الحالي وبدء احتساب الاستحقاق *</label><input id="balanceDateInput" type="date" required><small style="color:var(--muted)">تُحتسب زيادة 2.5 يوم بعد كل 30 يوماً من هذا التاريخ.</small>';
  formFields.appendChild(balanceDateWrap);
  // Feature styles are kept in app.css.
  function syncCredits(employee) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!employee.accrualAnchor) {
      employee.accrualAnchor = iso(today);
      return false
    }
    const anchor = date(employee.accrualAnchor), periods = Math.floor((today - anchor)/86400000/30);
    if (periods > 0) {
      employee.leaveBalance = (+employee.leaveBalance || 0) + periods*2.5;
      anchor.setDate(anchor.getDate() + periods*30);
      employee.accrualAnchor = iso(anchor);
      return true
    }
    return false;
  }
  employees.forEach(syncCredits);
  save();
  function applyMonthlyAccrual() {
    let changed = false;
    employees.forEach(e => {
      if (syncCredits(e))changed = true
    });
    if (changed) {
      save();
      render()
    }
  }
  window.setInterval(applyMonthlyAccrual, 60*60*1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden)applyMonthlyAccrual()
  });
  // Add leave balance fields to the employee form.
  const oldOpenModal = openModal;
  openModal = function(employee) {
    oldOpenModal(employee);
    document.getElementById('leaveBalanceInput').value = employee ? remaining(employee): ANNUAL;
    document.getElementById('balanceDateInput').value = employee?.accrualAnchor || iso(new Date());
  };
  form.onsubmit = async function(event) {
    event.preventDefault();
    const name = document.getElementById('name').value.trim();
    const number = document.getElementById('number').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const startDate = document.getElementById('startDate').value;
    const leaveBalance = Number(document.getElementById('leaveBalanceInput').value);
    const balanceDate = document.getElementById('balanceDateInput').value;
    if (employees.some(e => e.number.toLowerCase() === number.toLowerCase() && e.id !== editingId)) {
      toast('الرقم الوظيفي مسجل لموظف آخر');
      return
    }
    if (!Number.isFinite(leaveBalance) || leaveBalance < 0 || !balanceDate) {
      toast('أدخل رصيداً صحيحاً وتاريخاً للرصيد');
      return
    }
    if (date(startDate).getDay() !== 6 && !confirm('التاريخ المحدد ليس يوم سبت. هل تريد المتابعة؟'))return;
    const isNewEmployee = !editingId;
    let savedEmployee;
    if (editingId) {
      const employee = employees.find(e => e.id === editingId);
      Object.assign(employee, {
        name, number, phone, startDate, leaveBalance, accrualAnchor: balanceDate
      });
      syncCredits(employee);
      savedEmployee = employee;
    }
    else {
      const employee = {
        id: crypto.randomUUID(), name, number, phone, startDate, leaveBalance, leaveUsed: {
        }, accrualAnchor: balanceDate
      };
      syncCredits(employee);
      employees.unshift(employee);
      selectedId = employee.id;
      savedEmployee = employee;
    }
    try {
      const saveOperation = window.MANAWIB_SAVE_EMPLOYEES_STRICT || save;
      await saveOperation();
    }
    catch { toast('لم تُحفظ البيانات. تحقق من الاتصال ثم أعد المحاولة.'); return; }
    closeModal();
    render();
    toast(editingId ? 'تم تحديث البيانات': 'تمت إضافة الموظف');
    if (window.MANAWIB_AFTER_EMPLOYEE_SAVE) await window.MANAWIB_AFTER_EMPLOYEE_SAVE(savedEmployee, isNewEmployee);
  };
  // Add the forecast, calendar, and holidays to employee details.
  const oldRenderDetail = renderDetail;
  renderDetail = function() {
    oldRenderDetail();
    const employee = employees.find(e => e.id === selectedId);
    if (!employee)return;
    const todayLabel = document.createElement('small');
    todayLabel.className = 'today-before-shift';
    todayLabel.textContent = 'تاريخ اليوم: ' + fmt(new Date());
    const nextShiftMetric = document.querySelectorAll('#detail .metric')[1];
    if (nextShiftMetric)nextShiftMetric.insertBefore(todayLabel, nextShiftMetric.firstChild);
    const sections = document.querySelectorAll('#detail .section');
    const leaveSection = sections[0];
    if (leaveSection) {
      const spent = used(employee, yearNow());
      leaveSection.innerHTML = '<div class="section-title"><h3>رصيد الإجازة السنوية المدفوعة</h3><small>استحقاق: 2.5 يوم لكل 30 يوماً</small></div><div class="leave-box"><div><div class="leave-text">المستخدم في ' + yearNow() + ': ' + spent + ' يوم</div><div class="leave-bar"><i style="width:' + Math.min(100, spent/ANNUAL*100) + '%"></i></div></div><div style="text-align:left"><div class="balance-emphasis">' + remaining(employee) + ' يوم</div><div class="leave-text">إجمالي الرصيد المتبقي</div></div></div><div class="forecast-box"><div><strong>الرصيد المتوقع في التاريخ المختار</strong><button type="button" class="calendar-trigger" id="calendarTrigger"><span id="calendarTriggerText"></span><span>▦ اختر التاريخ</span></button><div class="forecast-result" id="forecastResult"></div></div><div class="forecast-calendar" id="forecastCalendar" style="display:none"><div class="calendar-controls"><button type="button" id="calendarPrev" aria-label="الشهر السابق">‹</button><select id="calendarMonth" aria-label="الشهر"></select><input id="calendarYear" type="number" min="1900" max="2200" aria-label="السنة"><button type="button" id="calendarNext" aria-label="الشهر التالي">›</button></div><div class="calendar-weekdays"><span>سبت</span><span>أحد</span><span>إثنين</span><span>ثلاثاء</span><span>أربعاء</span><span>خميس</span><span>جمعة</span></div><div class="calendar-days" id="calendarDays"></div><div class="calendar-legend"><i></i> بداية شفت · اختر يوماً لعرض الرصيد المتوقع</div></div></div><p class="form-note">تظهر بداية كل شفت باللون الأخضر. اختر موعداً يناسب بداية الشفت أو الموعد الذي تخطط له؛ وتُقدّر الزيادة نسبياً داخل الشهر (2.5 يوم لكل 30 يوماً) حتى يظهر الاستحقاق المتراكم قبل اكتمال الشهر.</p><div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap"><button class="button soft small-btn" id="useLeave">− تسجيل إجازة مستخدمة</button></div><p class="form-note">الرصيد غير المستخدم يبقى محفوظاً ويُرحّل.</p>';
      const forecastResult = document.getElementById('forecastResult'), calendarDays = document.getElementById('calendarDays'), calendarMonth = document.getElementById('calendarMonth'), calendarYear = document.getElementById('calendarYear'), forecastCalendar = document.getElementById('forecastCalendar'), calendarTrigger = document.getElementById('calendarTrigger'), calendarTriggerText = document.getElementById('calendarTriggerText');
      let selectedForecast = new Date();
      selectedForecast.setHours(0, 0, 0, 0);
      let viewYear = selectedForecast.getFullYear(), viewMonth = selectedForecast.getMonth();
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      calendarMonth.innerHTML = monthNames.map((name, index) => '<option value="' + index + '">' + name + '</option>').join('');
      calendarYear.value = viewYear;
      calendarMonth.value = String(viewMonth);
      const updateForecast = function() {
        const target = date(iso(selectedForecast)), today = new Date();
        today.setHours(0, 0, 0, 0);
        const anchor = date(employee.accrualAnchor || iso(today));
        calendarTriggerText.textContent = fmt(target);
        const accruedDays = target < today ? 0: Math.max(0, (target - anchor)/86400000);
        const gain = accruedDays/30*2.5, total = remaining(employee) + gain;
        const start = date(employee.startDate), elapsed = Math.floor((target - start)/86400000), phase = ((elapsed%28) + 28)%28, shiftPhase = phase < 14 ? 'ضمن فترة الدوام': 'ضمن إجازة الشفت';
        forecastResult.innerHTML = '<div class="forecast-caption">' + (target < today ? 'تاريخ سابق · ': '') + fmt(target) + ' · ' + shiftPhase + '</div><div class="forecast-numbers"><div><strong class="forecast-growth">+' + gain.toFixed(2).replace(/\.00$/, '') + ' يوم</strong><small>الزيادة المتوقعة</small></div><div class="forecast-total"><strong>' + total.toFixed(2).replace(/\.00$/, '') + ' يوم</strong><small>الرصيد المتوقع</small></div></div>';
      };
      const paintCalendar = function() {
        viewYear = Number(calendarYear.value) || viewYear;
        const offset = (new Date(viewYear, viewMonth, 1).getDay() + 1)%7, daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate(), anchor = date(employee.startDate), today = new Date();
        today.setHours(0, 0, 0, 0);
        let html = '';
        for (let blank = 0;
        blank < offset;
        blank++)html += '<span class="calendar-blank"></span>';
        for (let day = 1;
        day <= daysInMonth;
        day++) {
          const value = new Date(viewYear, viewMonth, day), delta = Math.round((value - anchor)/86400000), isStart = ((delta%28) + 28)%28 === 0, isSelected = iso(value) === iso(selectedForecast), isToday = iso(value) === iso(today);
          html += '<button type="button" class="calendar-day' + (isStart ? ' shift-start': '') + (isSelected ? ' selected': '') + '" data-date="' + iso(value) + '" title="' + (isStart ? 'بداية شفت': isToday ? 'اليوم': '') + '" aria-pressed="' + isSelected + '">' + day + '</button>';
        }
        calendarDays.innerHTML = html;
        calendarDays.querySelectorAll('[data-date]').forEach(button => button.onclick = function() {
          selectedForecast = date(button.dataset.date);
          updateForecast();
          paintCalendar();
          forecastCalendar.style.display = 'none'
        });
        calendarMonth.value = String(viewMonth);
      };
      calendarMonth.onchange = function() {
        viewMonth = Number(this.value);
        paintCalendar()
      };
      calendarYear.onchange = paintCalendar;
      calendarTrigger.onclick = function() {
        forecastCalendar.style.display = forecastCalendar.style.display === 'none' ? 'block': 'none'
      };
      document.getElementById('calendarPrev').onclick = function() {
        viewMonth--;
        if (viewMonth < 0) {
          viewMonth = 11;
          viewYear--
        }
        calendarYear.value = viewYear;
        paintCalendar()
      };
      document.getElementById('calendarNext').onclick = function() {
        viewMonth++;
        if (viewMonth > 11) {
          viewMonth = 0;
          viewYear++
        }
        calendarYear.value = viewYear;
        paintCalendar()
      };
      paintCalendar();
      updateForecast();
      document.getElementById('useLeave').onclick = function() {
        const amount = prompt('كم يوماً تريد تسجيله كإجازة سنوية مستخدمة؟ الرصيد الحالي: ' + remaining(employee) + ' يوم');
        if (amount === null)return;
        const days = Number(amount);
        if (!Number.isInteger(days) || days < 1) {
          toast('أدخل عدداً صحيحاً أكبر من صفر');
          return
        }
        if (days > remaining(employee)) {
          toast('الرصيد المتاح ' + remaining(employee) + ' يوم فقط');
          return
        }
        employee.leaveBalance -= days;
        employee.leaveUsed[yearNow()] = (employee.leaveUsed[yearNow()] || 0) + days;
        save();
        render();
        toast('تم تسجيل ' + days + ' يوم وخصمها من الرصيد');
      };
    }
    const title = [...document.querySelectorAll('#detail .section-title')].find(x => x.querySelector('#yearPicker'));
    if (title && !document.getElementById('holidayManagerBtn')) {
      const tools = document.createElement('div');
      tools.className = 'schedule-tools';
      const button = document.createElement('button');
      button.id = 'holidayManagerBtn';
      button.className = 'button ghost small-btn';
      button.textContent = 'إدارة العطلات';
      button.onclick = openHolidayManager;
      title.appendChild(tools);
      tools.append(button, title.querySelector('#yearPicker'));
    }
    const table = document.querySelector('#detail .shift-table');
    if (table) {
      const year = +(document.getElementById('yearPicker')?.value || yearNow());
      const slots = shifts(employee, year), body = table.tBodies[0];
      table.tHead.rows[0].innerHTML = '<th>#</th><th>نوع الفترة</th><th>من تاريخ</th><th>إلى تاريخ</th><th>الحالة</th><th>إجازة رسمية خلالها</th>';
      const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      function periodRow(number, label, start, end, kind) {
        const active = today >= start && today <= end, future = start > today;
        const state = active ? 'جارية': future ? 'قادمة': 'انتهت';
        const holidayList = hitHolidays( {
          start, end
        });
        const holidayText = holidayList.length ? holidayList.map(h => '<span class="holiday-pill" title="' + esc(h.name) + '">' + esc(h.name) + ' · ' + fmt(date(h.start)) + (h.end !== h.start ? ' – ' + fmt(date(h.end)): '') + '</span>').join(''): '—';
        const stateClass = active ? 'status-active': future ? 'status-future': 'status-ended';
        return '<tr class="' + (active ? 'current': '') + '"><td>' + number + '</td><td><span class="badge ' + (kind === 'leave' ? 'next': '') + '">' + label + '</span></td><td>' + fmt(start) + (kind === 'work' ? ' · 06:00 ص': '') + '</td><td>' + fmt(end) + (kind === 'work' ? ' · 06:00 ص': '') + '</td><td><span class="badge ' + stateClass + '">' + state + '</span></td><td class="holiday-cell">' + holidayText + '</td></tr>';
      }
      body.innerHTML = slots.map((s, index) => {
        const workEnd = addDays(s.start, 13), leaveStart = addDays(s.start, 14), leaveEnd = addDays(s.start, 27);
        return periodRow(index + 1, 'دوام · 14 يوم', s.start, workEnd, 'work') + periodRow(index + 1, 'إجازة · 14 يوم', leaveStart, leaveEnd, 'leave');
      }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--muted)">لا توجد فترات في هذه السنة.</td></tr>';
      const note = table.parentElement.querySelector('.table-note');
      if (note)note.textContent = 'يعرض الجدول كل دورة كسطرين متتابعين: 14 يوم دوام ثم 14 يوم إجازة. بداية الدوام السبت الساعة 6:00 صباحاً، ونهاية فترة الدوام الجمعة الساعة 6:00 صباحاً. تتكرر الدورة كل 28 يوماً.' + (date(employee.startDate).getDay() !== 6 ? ' تاريخ البداية المُدخل ليس يوم سبت.': '');
    }
  };
  // Add a small editor for official holiday dates. Future moon-based dates can be entered
  // when Oman publishes the actual Gregorian dates.
  document.body.insertAdjacentHTML('beforeend', '<div class="modal-back" id="holidayModal"><div class="modal"><div class="modal-head"><h2>العطلات الرسمية في عُمان</h2><button class="close" id="closeHoliday">✕</button></div><div class="form"><p class="form-note">تظهر العطلة بجانب الشفت إذا تداخلت أيامهما. أضف المواعيد بعد إعلانها الرسمي، خصوصاً تواريخ الأعياد الهجرية.</p><div class="holiday-list" id="holidayList"></div><form id="holidayForm"><div class="holiday-form"><div class="field full"><label>اسم العطلة</label><input id="holidayName" required placeholder="مثال: إجازة اليوم الوطني"></div><div class="field"><label>من تاريخ</label><input id="holidayStart" type="date" required></div><div class="field"><label>إلى تاريخ</label><input id="holidayEnd" type="date" required></div><div class="field full"><label>رابط الإعلان الرسمي (اختياري)</label><input id="holidaySource" type="url" placeholder="https://..."></div></div><div class="modal-actions" style="padding:14px 0 0;border:0"><button class="button primary" type="submit">إضافة عطلة</button></div></form></div></div></div>');
  const holidayModal = document.getElementById('holidayModal');
  function paintHolidays() {
    holidays.sort((a, b) => a.start.localeCompare(b.start));
    document.getElementById('holidayList').innerHTML = holidays.length ? holidays.map(h => '<div class="holiday-item"><span><strong>' + esc(h.name) + '</strong><br>' + fmt(date(h.start)) + (h.end !== h.start ? ' – ' + fmt(date(h.end)): '') + (h.source ? ' · <a href="' + esc(h.source) + '" target="_blank" rel="noopener">مصدر رسمي</a>': '') + '</span><button class="button danger small-btn" data-delete-holiday="' + esc(h.id) + '">حذف</button></div>').join(''): '<div class="empty-list">لا توجد عطلات محفوظة.</div>';
    document.querySelectorAll('[data-delete-holiday]').forEach(b => b.onclick = function() {
      holidays = holidays.filter(h => h.id !== b.dataset.deleteHoliday);
      saveHolidays();
      paintHolidays();
      renderDetail()
    });
  }
  function openHolidayManager() {
    paintHolidays();
    holidayModal.classList.add('show')
  }
  document.getElementById('closeHoliday').onclick = () => holidayModal.classList.remove('show');
  holidayModal.onclick = event => {
    if (event.target === holidayModal)holidayModal.classList.remove('show')
  };
  document.getElementById('holidayForm').onsubmit = function(event) {
    event.preventDefault();
    const name = document.getElementById('holidayName').value.trim(), start = document.getElementById('holidayStart').value, end = document.getElementById('holidayEnd').value, source = document.getElementById('holidaySource').value.trim();
    if (end < start) {
      toast('تاريخ النهاية يجب أن يكون بعد البداية');
      return
    }
    holidays.push( {
      id: crypto.randomUUID(), name, start, end, source
    });
    saveHolidays();
    this.reset();
    paintHolidays();
    renderDetail();
    toast('تمت إضافة العطلة الرسمية');
  };
  saveHolidays();
  renderDetail();
})();
