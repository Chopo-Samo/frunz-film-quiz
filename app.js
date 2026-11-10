(() => {
  'use strict';

  const config = window.QUIZ_CONFIG || {};
  const questions = Array.isArray(config.questions) ? config.questions : [];
  const revealAfterVideo = config.revealAfterVideo !== false;
  const optionBadges = Array.isArray(config.optionBadges) && config.optionBadges.length > 0
    ? config.optionBadges
    : ['1', '2', '3', '4'];

  const state = {
    index: 0,
    score: 0,
    phase: 'start', // 'start' | 'watching' | 'answering' | 'feedback' | 'results'
    selectedNumber: null,
    results: [],
    prefetchedUrls: new Set(),
    activePlayToken: 0,
  };

  const els = {
    quizTitle: document.getElementById('quiz-title'),
    headerMeta: document.getElementById('header-meta'),
    progressBadge: document.getElementById('progress-badge'),
    scoreBadge: document.getElementById('score-badge'),
    announcer: document.getElementById('live-announcer'),

    screenStart: document.getElementById('screen-start'),
    startHeading: document.getElementById('start-heading'),
    startCount: document.getElementById('start-count'),
    startSubtitle: document.getElementById('start-subtitle'),
    startBtn: document.getElementById('start-btn'),

    screenQuiz: document.getElementById('screen-quiz'),
    quizStageHeading: document.getElementById('quiz-stage-heading'),
    quizProgress: document.getElementById('quiz-progress'),
    video: document.getElementById('quiz-video'),
    videoStatusBadge: document.getElementById('video-status-badge'),
    autoplayOverlay: document.getElementById('autoplay-overlay'),
    overlayPlayBtn: document.getElementById('overlay-play-btn'),
    videoError: document.getElementById('video-error'),
    videoErrorText: document.getElementById('video-error-text'),
    retryVideoBtn: document.getElementById('retry-video-btn'),
    errorShowAnswersBtn: document.getElementById('error-show-answers-btn'),
    videoTimelineFill: document.getElementById('video-timeline-fill'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    replayBtn: document.getElementById('replay-btn'),
    muteBtn: document.getElementById('mute-btn'),
    volumeSlider: document.getElementById('volume-slider'),
    videoTime: document.getElementById('video-time'),
    skipWaitBtn: document.getElementById('skip-wait-btn'),
    watchNotice: document.getElementById('watch-notice'),

    answersPanel: document.getElementById('answers-panel'),
    questionText: document.getElementById('question-text'),
    optionsGrid: document.getElementById('options-grid'),
    feedbackBar: document.getElementById('feedback-bar'),
    feedbackBox: document.getElementById('feedback-box'),
    feedbackVerdict: document.getElementById('feedback-verdict'),
    feedbackDetail: document.getElementById('feedback-detail'),
    nextBtn: document.getElementById('next-btn'),

    screenResults: document.getElementById('screen-results'),
    resultsHeading: document.getElementById('results-heading'),
    finalScoreValue: document.getElementById('final-score-value'),
    finalScorePercent: document.getElementById('final-score-percent'),
    finalVerdict: document.getElementById('final-verdict'),
    resultsSummary: document.getElementById('results-summary'),
    restartBtn: document.getElementById('restart-btn'),
  };

  function getBadgeForIndex(idx) {
    return optionBadges[idx] || String(idx + 1);
  }

  function formatSeconds(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const whole = Math.floor(sec);
    const mins = Math.floor(whole / 60);
    const secs = String(whole % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function announce(message) {
    els.announcer.textContent = '';
    window.setTimeout(() => {
      els.announcer.textContent = message;
    }, 30);
  }

  function setScreen(targetScreen) {
    const screens = [els.screenStart, els.screenQuiz, els.screenResults];
    for (const screen of screens) {
      const isActive = screen === targetScreen;
      screen.hidden = !isActive;
      screen.inert = !isActive;
    }
    els.headerMeta.hidden = targetScreen !== els.screenQuiz;
  }

  function getCorrectNumber(question) {
    if (Number.isInteger(question.correct)) return question.correct;
    if (Number.isInteger(question.correctIndex)) return question.correctIndex + 1;
    return 1;
  }

  function updateHeaderCounters() {
    const total = questions.length;
    els.progressBadge.textContent = `Հարց ${state.index + 1} / ${total}`;
    els.scoreBadge.textContent = `Միավոր՝ ${state.score}`;
    els.quizProgress.max = Math.max(1, total);
    els.quizProgress.value = state.index + (state.phase === 'feedback' ? 1 : 0);
  }

  function updateVideoTimeline() {
    const duration = els.video.duration;
    const current = els.video.currentTime;
    const ratio = Number.isFinite(duration) && duration > 0 ? Math.min(1, current / duration) : 0;
    els.videoTimelineFill.style.transform = `scaleX(${ratio})`;
    els.videoTime.textContent = `${formatSeconds(current)} / ${formatSeconds(duration)}`;
  }

  function updateSoundControls() {
    const isMuted = els.video.muted || els.video.volume === 0;
    els.muteBtn.textContent = isMuted ? 'Ձայնը՝ Անջատված' : 'Ձայնը՝ Միացված';
    els.volumeSlider.value = els.video.muted ? '0' : String(els.video.volume);
  }

  function updatePlayButton() {
    els.playPauseBtn.textContent = els.video.paused ? 'Շարունակել' : 'Դադար';
  }

  function prefetchNextVideo() {
    const nextQuestion = questions[state.index + 1];
    if (!nextQuestion || !nextQuestion.video) return;
    if (state.prefetchedUrls.has(nextQuestion.video)) return;

    state.prefetchedUrls.add(nextQuestion.video);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'video';
    link.href = nextQuestion.video;
    document.head.appendChild(link);
  }

  async function tryPlayVideo(fromStart = false) {
    const playToken = ++state.activePlayToken;
    els.autoplayOverlay.hidden = true;
    els.videoError.hidden = true;

    if (fromStart) {
      try {
        els.video.currentTime = 0;
      } catch {
        // Անտեսում ենք մինչև մետատվյալների բեռնումը
      }
    }

    try {
      await els.video.play();
      if (playToken !== state.activePlayToken) return;
      els.videoStatusBadge.textContent = 'Դիտում ենք';
      updatePlayButton();
    } catch (err) {
      if (playToken !== state.activePlayToken) return;
      if (err && err.name === 'AbortError') return;

      els.videoStatusBadge.textContent = 'Սեղմեք՝ սկսելու համար';
      els.autoplayOverlay.hidden = false;
      updatePlayButton();
    }
  }

  function renderOptions(question) {
    els.questionText.textContent = question.question || `Հարց ${state.index + 1}`;
    els.optionsGrid.replaceChildren();

    const options = Array.isArray(question.options) ? question.options : [];
    options.forEach((labelText, idx) => {
      const optionNumber = idx + 1;
      const badgeText = getBadgeForIndex(idx);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'option-btn';
      btn.dataset.optionNumber = String(optionNumber);

      const numSpan = document.createElement('span');
      numSpan.className = 'option-num';
      numSpan.textContent = badgeText;

      const textSpan = document.createElement('span');
      textSpan.className = 'option-label';
      textSpan.textContent = labelText;

      const statusSpan = document.createElement('span');
      statusSpan.className = 'option-status';

      btn.append(numSpan, textSpan, statusSpan);
      btn.addEventListener('click', () => handleSelectOption(optionNumber));
      els.optionsGrid.appendChild(btn);
    });
  }

  function revealOptions(moveFocusToFirstOption) {
    if (state.phase === 'answering' || state.phase === 'feedback') return;

    state.phase = 'answering';
    els.watchNotice.hidden = true;
    els.skipWaitBtn.hidden = true;
    els.answersPanel.hidden = false;
    els.answersPanel.classList.remove('is-revealed');
    void els.answersPanel.offsetWidth;
    els.answersPanel.classList.add('is-revealed');

    const count = els.optionsGrid.children.length;
    announce(`Հայտնվեցին ${count} տարբերակները։ Ընտրեք ճիշտ պատասխանը։`);

    if (moveFocusToFirstOption) {
      const firstBtn = els.optionsGrid.querySelector('.option-btn');
      if (firstBtn) firstBtn.focus();
    }
  }

  function handleSelectOption(chosenNumber) {
    if (state.phase !== 'answering') return;

    const question = questions[state.index];
    const correctNumber = getCorrectNumber(question);
    const isCorrect = chosenNumber === correctNumber;

    state.phase = 'feedback';
    state.selectedNumber = chosenNumber;

    if (isCorrect) {
      state.score += 1;
    }

    const options = Array.isArray(question.options) ? question.options : [];
    const chosenBadge = getBadgeForIndex(chosenNumber - 1);
    const correctBadge = getBadgeForIndex(correctNumber - 1);
    const chosenText = options[chosenNumber - 1] || '';
    const correctLabel = options[correctNumber - 1] || '';

    state.results.push({
      question: question.question || `Հարց ${state.index + 1}`,
      chosenBadge,
      chosenText,
      correctBadge,
      correctText: correctLabel,
      isCorrect,
    });

    const buttons = els.optionsGrid.querySelectorAll('.option-btn');
    for (const btn of buttons) {
      const btnNum = Number(btn.dataset.optionNumber);
      const statusEl = btn.querySelector('.option-status');
      btn.disabled = true;

      if (btnNum === correctNumber) {
        btn.classList.add('is-correct');
        statusEl.textContent = btnNum === chosenNumber ? '✓ Ճիշտ է' : '✓ Ճիշտ պատասխան';
      } else if (btnNum === chosenNumber) {
        btn.classList.add('is-wrong');
        statusEl.textContent = '✕ Սխալ է';
      } else {
        btn.classList.add('is-dimmed');
      }
    }

    els.feedbackBar.classList.remove('is-correct', 'is-wrong');
    els.feedbackBar.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    els.feedbackVerdict.textContent = isCorrect
      ? `✓ Ճիշտ է։ Դա ${correctBadge}) ${correctLabel} տարբերակն է։`
      : `✕ Սխալ է։ Ճիշտ պատասխանն է՝ ${correctBadge}) ${correctLabel}`;
    els.feedbackDetail.textContent = question.explanation ? question.explanation : '';

    const isLast = state.index >= questions.length - 1;
    els.nextBtn.textContent = isLast ? 'Արդյունքները →' : 'Հաջորդ հարցը →';
    els.feedbackBar.hidden = false;

    updateHeaderCounters();
    announce(
      isCorrect
        ? `Ճիշտ է։ ${correctBadge}) ${correctLabel}։`
        : `Սխալ է։ Ճիշտ պատասխանն է՝ ${correctBadge}) ${correctLabel}։`
    );
  }

  function loadQuestion(index) {
    state.index = index;
    state.selectedNumber = null;
    state.phase = 'watching';

    const question = questions[index];
    const quizName = config.title || 'Ֆրունզի ֆիլմերի վիկտորինա';
    document.title = `Հարց ${index + 1} / ${questions.length} | ${quizName}`;
    els.quizStageHeading.textContent = `Հարց ${index + 1} / ${questions.length}`;

    els.feedbackBar.hidden = true;
    els.feedbackBar.classList.remove('is-correct', 'is-wrong');
    els.answersPanel.classList.remove('is-revealed');

    renderOptions(question);
    updateHeaderCounters();

    const shouldHideInitially = revealAfterVideo && question.revealAfterVideo !== false;
    els.answersPanel.hidden = shouldHideInitially;
    els.watchNotice.hidden = !shouldHideInitially;
    els.skipWaitBtn.hidden = !shouldHideInitially;

    els.videoStatusBadge.textContent = 'Բեռնում…';
    els.videoTimelineFill.style.transform = 'scaleX(0)';
    els.videoTime.textContent = '0:00 / 0:00';
    els.videoError.hidden = true;
    els.autoplayOverlay.hidden = true;

    els.video.pause();
    els.video.src = question.video;
    els.video.load();
    tryPlayVideo(true);

    if (!shouldHideInitially) {
      revealOptions(false);
    }

    els.quizStageHeading.focus();
  }

  function showResults() {
    state.phase = 'results';
    els.video.pause();
    setScreen(els.screenResults);

    const total = questions.length;
    const percent = total > 0 ? Math.round((state.score / total) * 100) : 0;
    const quizName = config.title || 'Ֆրունզի ֆիլմերի վիկտորինա';
    document.title = `Արդյունքներ (${state.score} / ${total}) | ${quizName}`;

    els.finalScoreValue.textContent = `${state.score}՝ ${total}-ից`;
    els.finalScorePercent.textContent = `Դուք ճիշտ պատասխանել եք ${total} հարցից ${state.score}-ին (${percent}%)`;

    if (percent === 100) {
      els.finalVerdict.textContent = 'Հիանալի արդյունք։ Դուք գիտեք Ֆրունզի բոլոր ֆիլմերը։';
    } else if (percent >= 70) {
      els.finalVerdict.textContent = 'Շատ լավ արդյունք։ Կեցցե՛ք։';
    } else if (percent >= 40) {
      els.finalVerdict.textContent = 'Լավ փորձ է։ Կարող եք խաղալ ևս մեկ անգամ։';
    } else {
      els.finalVerdict.textContent = 'Փորձեք կրկին և բարելավեք ձեր արդյունքը։';
    }

    els.resultsSummary.replaceChildren();
    state.results.forEach((item, idx) => {
      const li = document.createElement('li');
      li.className = `summary-item ${item.isCorrect ? 'is-correct' : 'is-wrong'}`;

      const textWrap = document.createElement('div');
      const qEl = document.createElement('div');
      qEl.className = 'summary-q';
      qEl.textContent = `${idx + 1}. ${item.question}`;

      const aEl = document.createElement('div');
      aEl.className = 'summary-a';
      aEl.textContent = item.isCorrect
        ? `Պատասխան՝ ${item.correctBadge}) ${item.correctText}`
        : `Ընտրված՝ ${item.chosenBadge}) ${item.chosenText} · Ճիշտ՝ ${item.correctBadge}) ${item.correctText}`;

      textWrap.append(qEl, aEl);

      const badge = document.createElement('span');
      badge.className = 'summary-badge';
      badge.textContent = item.isCorrect ? '✓ Ճիշտ' : '✕ Սխալ';

      li.append(textWrap, badge);
      els.resultsSummary.appendChild(li);
    });

    announce(`Վիկտորինան ավարտվեց։ Ձեր արդյունքը՝ ${state.score}՝ ${total}-ից։`);
    els.resultsHeading.focus();
  }

  function startQuiz() {
    if (questions.length === 0) return;
    state.score = 0;
    state.results = [];
    setScreen(els.screenQuiz);
    loadQuestion(0);
  }

  function initStartScreen() {
    const title = config.title || 'Ֆրունզի ֆիլմերի վիկտորինա';
    els.quizTitle.textContent = title;
    document.title = title;

    if (config.subtitle) {
      els.startSubtitle.textContent = config.subtitle;
    }
    if (config.startButtonText) {
      els.startBtn.textContent = config.startButtonText;
    }

    if (questions.length === 0) {
      els.startCount.textContent = 'Հարցեր չկան';
      els.startSubtitle.textContent = 'Ավելացրեք տեսանյութեր և հարցեր quiz-data.js ֆայլում։';
      els.startBtn.disabled = true;
    } else {
      els.startCount.textContent = `${questions.length} հարց`;
      els.startBtn.disabled = false;
    }

    setScreen(els.screenStart);
    updateSoundControls();
  }

  // Կոճակների իրադարձություններ
  els.startBtn.addEventListener('click', startQuiz);
  els.restartBtn.addEventListener('click', startQuiz);

  els.overlayPlayBtn.addEventListener('click', () => {
    tryPlayVideo(false);
  });

  els.playPauseBtn.addEventListener('click', () => {
    if (els.video.paused) {
      tryPlayVideo(false);
    } else {
      els.video.pause();
    }
  });

  els.replayBtn.addEventListener('click', () => {
    tryPlayVideo(true);
  });

  els.muteBtn.addEventListener('click', () => {
    if (els.video.muted || els.video.volume === 0) {
      els.video.muted = false;
      if (els.video.volume === 0) {
        els.video.volume = 0.8;
      }
    } else {
      els.video.muted = true;
    }
    updateSoundControls();
  });

  els.volumeSlider.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    els.video.volume = value;
    els.video.muted = value === 0;
    updateSoundControls();
  });

  els.skipWaitBtn.addEventListener('click', () => {
    revealOptions(true);
  });

  els.retryVideoBtn.addEventListener('click', () => {
    els.video.load();
    tryPlayVideo(true);
  });

  els.errorShowAnswersBtn.addEventListener('click', () => {
    revealOptions(true);
  });

  els.nextBtn.addEventListener('click', () => {
    if (state.index + 1 < questions.length) {
      loadQuestion(state.index + 1);
    } else {
      showResults();
    }
  });

  // <video> իրադարձություններ
  els.video.addEventListener('loadedmetadata', updateVideoTimeline);
  els.video.addEventListener('timeupdate', updateVideoTimeline);

  els.video.addEventListener('playing', () => {
    els.videoStatusBadge.textContent = 'Դիտում ենք';
    updatePlayButton();
    prefetchNextVideo();
  });

  els.video.addEventListener('pause', () => {
    if (!els.video.ended && state.phase !== 'results') {
      els.videoStatusBadge.textContent = 'Դադար';
    }
    updatePlayButton();
  });

  els.video.addEventListener('ended', () => {
    els.videoStatusBadge.textContent = 'Դիտված է';
    updatePlayButton();
    updateVideoTimeline();
    revealOptions(false);
  });

  els.video.addEventListener('error', () => {
    const currentQuestion = questions[state.index];
    const path = currentQuestion ? currentQuestion.video : '';
    els.videoStatusBadge.textContent = 'Ֆայլը չի գտնվել';
    els.videoErrorText.textContent = `Տեսանյութը չհաջողվեց բեռնել (${path})։ Համոզվեք, որ ֆայլը գտնվում է videos/ թղթապանակում։`;
    els.videoError.hidden = false;
    updatePlayButton();
  });

  // Ստեղնաշարի կարճ ստեղներ դասարանում հարմար կառավարման համար
  document.addEventListener('keydown', (event) => {
    if (state.phase === 'start' || state.phase === 'results') return;

    const target = event.target;
    const isInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    if (isInput) return;

    if (state.phase === 'answering' && ['1', '2', '3', '4'].includes(event.key)) {
      const num = Number(event.key);
      const count = els.optionsGrid.children.length;
      if (num <= count) {
        event.preventDefault();
        handleSelectOption(num);
      }
      return;
    }

    if (event.code === 'KeyR') {
      event.preventDefault();
      tryPlayVideo(true);
      return;
    }

    if (event.code === 'Space' && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      if (els.video.paused) {
        tryPlayVideo(false);
      } else {
        els.video.pause();
      }
      return;
    }

    if (event.code === 'Enter' && state.phase === 'feedback' && !(target instanceof HTMLButtonElement)) {
      event.preventDefault();
      els.nextBtn.click();
    }
  });

  initStartScreen();
})();
