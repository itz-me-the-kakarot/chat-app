/**
 * polls.js
 * Poll creation, layout option rendering, option addition, voting, and results percentage calculations
 */

function openPollModal() { 
  const modal = document.getElementById('pollModal');
  const question = document.getElementById('pollQuestion');
  if (modal) modal.classList.add('show'); 
  if (question) question.value = ''; 
  document.querySelectorAll('.poll-opt-input').forEach(i => i.value = ''); 
}

function closePollModal() { 
  const modal = document.getElementById('pollModal');
  if (modal) modal.classList.remove('show'); 
}

function addPollOption() {
  const input = document.createElement('input');
  input.type = 'text'; 
  input.className = 'poll-opt-input'; 
  input.placeholder = 'Option ' + (document.querySelectorAll('.poll-opt-input').length + 1);
  const addBtn = document.querySelector('#pollModal .modal-content button[onclick="addPollOption()"]');
  if (addBtn) addBtn.parentNode.insertBefore(input, addBtn);
}

function sendPoll() {
  const q = document.getElementById('pollQuestion').value.trim();
  if (!q) return alert('Enter a question');
  const opts = Array.from(document.querySelectorAll('.poll-opt-input')).map(i => i.value.trim()).filter(v => v);
  if (opts.length < 2) return alert('Enter at least 2 options');
  closePollModal();
  const poll_data = { question: q, options: opts.map((opt, i) => ({ id: i, text: opt, votes: [] })) };
  socket.emit('private_message', { receiver: currentChat, message: '', sender_message: '', msg_type: 'poll', poll_data });
}

function votePoll(msgId, optId) {
  socket.emit('vote_poll', { msg_id: msgId, option_id: optId });
}

function renderPoll(m) {
  if (!m.poll_data) return '[Poll Data Missing]';
  const totalVotes = m.poll_data.options.reduce((sum, opt) => sum + opt.votes.length, 0);
  let html = `<div class="poll-msg"><div class="poll-q">${m.poll_data.question}</div>`;
  m.poll_data.options.forEach(opt => {
    const hasVoted = opt.votes.includes(me);
    const pct = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;
    html += `<div class="poll-opt ${hasVoted ? 'voted' : ''}" onclick="votePoll(${m.id}, ${opt.id})">
      <div class="bar" style="width:${pct}%"></div>
      <span class="opt-text">${opt.text}</span>
      <span class="opt-pct">${pct}%</span>
    </div>`;
  });
  return html + `</div>`;
}

console.log('✓ Polls module loaded');
