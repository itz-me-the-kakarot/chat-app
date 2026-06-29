import os
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta

from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import psycopg2
import psycopg2.extras

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey123'
socketio = SocketIO(app, cors_allowed_origins='*')

connected_users = {}
login_attempts = defaultdict(list)
RATE_LIMIT = 10
BLOCK_TIME = 10
DATABASE_URL = os.environ.get('DATABASE_URL')


def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute('''CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        display_name TEXT,
        password TEXT NOT NULL,
        public_key TEXT,
        avatar_url TEXT,
        theme_h INTEGER DEFAULT 217,
        theme_s INTEGER DEFAULT 91,
        theme_l INTEGER DEFAULT 64
    )''')

    cur.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        message TEXT,
        sender_message TEXT,
        msg_type TEXT DEFAULT 'text',
        media_url TEXT,
        reply_to TEXT,
        reactions JSONB DEFAULT '{}',
        deleted BOOLEAN DEFAULT FALSE,
        disappear_at TIMESTAMP,
        seen BOOLEAN DEFAULT FALSE,
        delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        seen_at TIMESTAMP,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    cur.execute('''CREATE TABLE IF NOT EXISTS friend_requests (
        id SERIAL PRIMARY KEY,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        UNIQUE(sender, receiver)
    )''')

    cur.execute('''CREATE TABLE IF NOT EXISTS chat_settings (
        id SERIAL PRIMARY KEY,
        user1 TEXT NOT NULL,
        user2 TEXT NOT NULL,
        wallpaper_url TEXT,
        disappear_timer INTEGER DEFAULT 0,
        UNIQUE(user1, user2)
    )''')

    cur.execute('''CREATE TABLE IF NOT EXISTS polls (
        id SERIAL PRIMARY KEY,
        msg_id INTEGER UNIQUE NOT NULL,
        question TEXT NOT NULL,
        options JSONB NOT NULL,
        votes JSONB DEFAULT '{}'
    )''')

    cur.execute('''CREATE TABLE IF NOT EXISTS pinned_messages (
        id SERIAL PRIMARY KEY,
        user1 TEXT NOT NULL,
        user2 TEXT NOT NULL,
        msg_id INTEGER,
        msg_text TEXT,
        msg_type TEXT DEFAULT 'text',
        media_url TEXT,
        UNIQUE(user1, user2)
    )''')

    conn.commit()

    # Idempotent schema migrations for existing deployments
    migrations = [
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS seen_at TIMESTAMP",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_h INTEGER DEFAULT 217",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_s INTEGER DEFAULT 91",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_l INTEGER DEFAULT 64",
    ]
    for sql in migrations:
        try:
            cur.execute(sql)
            conn.commit()
        except Exception:
            conn.rollback()

    cur.close()
    conn.close()


def is_rate_limited(ip):
    now = time.time()
    attempts = [t for t in login_attempts[ip] if now - t < BLOCK_TIME]
    login_attempts[ip] = attempts
    return len(attempts) >= RATE_LIMIT


def record_attempt(ip):
    login_attempts[ip].append(time.time())


def are_friends(a, b):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT 1 FROM friend_requests
        WHERE ((sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)) AND status='accepted'
    ''', (a, b, b, a))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row is not None


def get_chat_key(a, b):
    return tuple(sorted([a, b]))


def fmt_time(dt):
    """Return HH:MM AM/PM string from datetime or None."""
    if not dt:
        return None
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt)
        return dt.strftime('%I:%M %p')
    except Exception:
        return None


init_db()


# ── Auth ──────────────────────────────────────────────────────

@app.route('/')
def index():
    if 'user_id' not in session:
        return render_template('landing.html')
    return render_template('index.html', user_id=session['user_id'])


@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        ip = request.remote_addr
        if is_rate_limited(ip):
            return render_template('login.html', error=f'Too many attempts. Wait {BLOCK_TIME}s.')
        user_id = request.form['user_id'].strip().lower()
        password = request.form['password']
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT * FROM users WHERE user_id=%s', (user_id,))
        user = cur.fetchone()
        cur.close()
        conn.close()
        if user and check_password_hash(user['password'], password):
            session['user_id'] = user_id
            return redirect(url_for('index'))
        record_attempt(ip)
        time.sleep(1)
        error = 'Invalid ID or password'
    return render_template('login.html', error=error)


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    error = None
    if request.method == 'POST':
        user_id = request.form['user_id'].strip().lower()
        display_name = request.form.get('display_name', '').strip()
        password = request.form['password']
        import re as _re
        if not _re.match(r'^[a-z0-9_]{3,20}$', user_id):
            error = 'ID must be 3-20 chars: letters, numbers, underscore only'
            return render_template('signup.html', error=error)
        hashed = generate_password_hash(password)
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute('INSERT INTO users (user_id, display_name, password) VALUES (%s,%s,%s)',
                        (user_id, display_name or None, hashed))
            conn.commit()
            cur.close()
            conn.close()
            session['user_id'] = user_id
            return redirect(url_for('index'))
        except Exception as e:
            conn.rollback()
            cur.close()
            conn.close()
            error = str(e)
    return render_template('signup.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/reset_pw/<uid>/<newpw>')
def reset_pw(uid, newpw):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET password=%s WHERE user_id=%s', (generate_password_hash(newpw), uid))
    conn.commit()
    cur.close()
    conn.close()
    return 'done'


# ── Keys ──────────────────────────────────────────────────────

@app.route('/save_key', methods=['POST'])
def save_key():
    if 'user_id' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET public_key=%s WHERE user_id=%s', (data['key'], session['user_id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/pubkey/<uid>')
def pubkey(uid):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT public_key FROM users WHERE user_id=%s', (uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({'key': row['public_key'] if row and row['public_key'] else None})


# ── Profile & Avatar ──────────────────────────────────────────

@app.route('/profile')
def get_profile():
    if 'user_id' not in session:
        return jsonify({})
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT user_id, display_name, avatar_url, theme_h, theme_s, theme_l FROM users WHERE user_id=%s',
                (session['user_id'],))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(row) if row else {})


@app.route('/profile/<uid>')
def get_user_profile(uid):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT user_id, display_name, avatar_url FROM users WHERE user_id=%s', (uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(row) if row else {})


@app.route('/update_profile', methods=['POST'])
def update_profile():
    if 'user_id' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    if 'display_name' in data:
        cur.execute('UPDATE users SET display_name=%s WHERE user_id=%s',
                    (data['display_name'] or None, session['user_id']))
    if 'avatar_url' in data:
        cur.execute('UPDATE users SET avatar_url=%s WHERE user_id=%s',
                    (data['avatar_url'], session['user_id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


@app.route('/upload_avatar', methods=['POST'])
def upload_avatar():
    if 'user_id' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET avatar_url=%s WHERE user_id=%s', (data['url'], session['user_id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


# ── Theme ─────────────────────────────────────────────────────

@app.route('/theme', methods=['GET'])
def get_theme():
    if 'user_id' not in session:
        return jsonify({'h': 217, 's': 91, 'l': 64})
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT theme_h, theme_s, theme_l FROM users WHERE user_id=%s', (session['user_id'],))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if row:
        return jsonify({'h': row['theme_h'] or 217, 's': row['theme_s'] or 91, 'l': row['theme_l'] or 64})
    return jsonify({'h': 217, 's': 91, 'l': 64})


@app.route('/theme', methods=['POST'])
def save_theme():
    if 'user_id' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET theme_h=%s, theme_s=%s, theme_l=%s WHERE user_id=%s',
                (int(data.get('h', 217)), int(data.get('s', 91)), int(data.get('l', 64)), session['user_id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


# ── Chat Settings ─────────────────────────────────────────────

@app.route('/chat_settings/<other>')
def get_chat_settings(other):
    if 'user_id' not in session:
        return jsonify({})
    me = session['user_id']
    u1, u2 = get_chat_key(me, other)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT * FROM chat_settings WHERE user1=%s AND user2=%s', (u1, u2))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(row) if row else {'wallpaper_url': None, 'disappear_timer': 0})


@app.route('/update_chat_settings/<other>', methods=['POST'])
def update_chat_settings(other):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    data = request.json
    u1, u2 = get_chat_key(me, other)
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''INSERT INTO chat_settings (user1,user2,wallpaper_url,disappear_timer)
        VALUES (%s,%s,%s,%s) ON CONFLICT (user1,user2) DO UPDATE SET
        wallpaper_url=EXCLUDED.wallpaper_url, disappear_timer=EXCLUDED.disappear_timer''',
        (u1, u2, data.get('wallpaper_url'), data.get('disappear_timer', 0)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


# ── Users & Friends ───────────────────────────────────────────

@app.route('/users')
def get_users():
    if 'user_id' not in session:
        return jsonify([])
    q = request.args.get('q', '').lower()
    me = session['user_id']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT CASE WHEN sender=%s THEN receiver ELSE sender END as friend
        FROM friend_requests WHERE (sender=%s OR receiver=%s) AND status='accepted' ''', (me, me, me))
    friends = {r['friend'] for r in cur.fetchall()}
    cur.execute('SELECT user_id, display_name, avatar_url FROM users WHERE user_id != %s', (me,))
    users = cur.fetchall()
    cur.close()
    conn.close()
    online = list(connected_users.keys())
    result = []
    for u in users:
        if u['user_id'] in friends:
            continue
        dn = u['display_name'] or u['user_id']
        if q and q not in u['user_id'] and q not in dn.lower():
            continue
        result.append({'user_id': u['user_id'], 'display_name': dn,
                        'avatar_url': u['avatar_url'], 'online': u['user_id'] in online})
    return jsonify(result)


@app.route('/friends')
def get_friends():
    if 'user_id' not in session:
        return jsonify([])
    me = session['user_id']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT CASE WHEN sender=%s THEN receiver ELSE sender END as friend
        FROM friend_requests WHERE (sender=%s OR receiver=%s) AND status='accepted' ''', (me, me, me))
    rows = cur.fetchall()
    result = []
    for r in rows:
        f = r['friend']
        cur.execute('SELECT user_id, display_name, avatar_url FROM users WHERE user_id=%s', (f,))
        u = cur.fetchone()
        if u:
            result.append({'user_id': u['user_id'], 'display_name': u['display_name'] or u['user_id'],
                            'avatar_url': u['avatar_url'], 'online': f in connected_users})
    cur.close()
    conn.close()
    return jsonify(result)


@app.route('/friend_requests')
def get_friend_requests():
    if 'user_id' not in session:
        return jsonify([])
    me = session['user_id']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT sender FROM friend_requests WHERE receiver=%s AND status=%s', (me, 'pending'))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([r['sender'] for r in rows])


@app.route('/send_request/<to>', methods=['POST'])
def send_request(to):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('INSERT INTO friend_requests (sender,receiver) VALUES (%s,%s)', (me, to))
        conn.commit()
        cur.close()
        conn.close()
        if to in connected_users:
            socketio.emit('friend_request', {'from': me}, to=connected_users[to])
        return jsonify({'ok': True})
    except psycopg2.IntegrityError:
        return jsonify({'ok': False, 'error': 'Already sent'})


@app.route('/respond_request/<from_user>/<action>', methods=['POST'])
def respond_request(from_user, action):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    status = 'accepted' if action == 'accept' else 'rejected'
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE friend_requests SET status=%s WHERE sender=%s AND receiver=%s',
                (status, from_user, me))
    conn.commit()
    cur.close()
    conn.close()
    if status == 'accepted' and from_user in connected_users:
        socketio.emit('request_accepted', {'by': me}, to=connected_users[from_user])
    return jsonify({'ok': True})


@app.route('/remove_friend/<other>', methods=['POST'])
def remove_friend(other):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM friend_requests WHERE (sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)',
                (me, other, other, me))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})


# ── Messages & History ────────────────────────────────────────

@app.route('/history/<other>')
def history(other):
    if 'user_id' not in session:
        return jsonify([])
    me = session['user_id']
    if not are_friends(me, other):
        return jsonify([])
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT id, sender, message, sender_message, msg_type, media_url, reply_to,
        reactions, deleted, seen, delivered_at, seen_at, timestamp
        FROM messages WHERE (sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)
        ORDER BY timestamp ASC''', (me, other, other, me))
    msgs = cur.fetchall()

    cur.execute('''UPDATE messages SET seen=TRUE, seen_at=CURRENT_TIMESTAMP
        WHERE sender=%s AND receiver=%s AND seen=FALSE''', (other, me))
    conn.commit()

    # Fetch all poll data in one query
    poll_ids = [m['id'] for m in msgs if m['msg_type'] == 'poll']
    polls_map = {}
    if poll_ids:
        cur.execute('SELECT * FROM polls WHERE msg_id = ANY(%s)', (poll_ids,))
        for p in cur.fetchall():
            polls_map[p['msg_id']] = {
                'id': p['id'],
                'question': p['question'],
                'options': p['options'],
                'votes': p['votes'] or {}
            }

    cur.close()
    conn.close()

    result = []
    for m in msgs:
        item = {
            'id': m['id'],
            'sender': m['sender'],
            'message': m['message'],
            'sender_message': m['sender_message'],
            'msg_type': m['msg_type'],
            'media_url': m['media_url'],
            'reply_to': m['reply_to'],
            'reactions': m['reactions'] or {},
            'deleted': m['deleted'],
            'seen': m['seen'],
            'delivered_at': fmt_time(m.get('delivered_at')),
            'seen_at': fmt_time(m.get('seen_at')),
            'timestamp': str(m['timestamp']),
        }
        if m['msg_type'] == 'poll' and m['id'] in polls_map:
            item['poll'] = polls_map[m['id']]
        result.append(item)
    return jsonify(result)


@app.route('/delete_message/<int:msg_id>', methods=['POST'])
def delete_message(msg_id):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT sender,receiver FROM messages WHERE id=%s', (msg_id,))
    msg = cur.fetchone()
    if not msg or msg['sender'] != me:
        cur.close(); conn.close()
        return jsonify({'ok': False})
    cur.execute('UPDATE messages SET deleted=TRUE,message=NULL,sender_message=NULL,media_url=NULL WHERE id=%s',
                (msg_id,))
    conn.commit()
    receiver = msg['receiver']
    cur.close(); conn.close()
    if receiver in connected_users:
        socketio.emit('message_deleted', {'id': msg_id}, to=connected_users[receiver])
    if me in connected_users:
        socketio.emit('message_deleted', {'id': msg_id}, to=connected_users[me])
    return jsonify({'ok': True})


@app.route('/react/<int:msg_id>', methods=['POST'])
def react(msg_id):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    emoji = request.json.get('emoji')
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT reactions,sender,receiver FROM messages WHERE id=%s', (msg_id,))
    msg = cur.fetchone()
    if not msg:
        cur.close(); conn.close()
        return jsonify({'ok': False})
    reactions = msg['reactions'] or {}
    if emoji not in reactions:
        reactions[emoji] = []
    if me in reactions[emoji]:
        reactions[emoji].remove(me)
        if not reactions[emoji]:
            del reactions[emoji]
    else:
        reactions[emoji].append(me)
    cur.execute('UPDATE messages SET reactions=%s WHERE id=%s',
                (psycopg2.extras.Json(reactions), msg_id))
    conn.commit()
    other = msg['receiver'] if msg['sender'] == me else msg['sender']
    cur.close(); conn.close()
    payload = {'msg_id': msg_id, 'reactions': reactions}
    if other in connected_users:
        socketio.emit('reaction_update', payload, to=connected_users[other])
    if me in connected_users:
        socketio.emit('reaction_update', payload, to=connected_users[me])
    return jsonify({'ok': True, 'reactions': reactions})


@app.route('/media/<uid>')
def get_media(uid):
    if 'user_id' not in session:
        return jsonify([])
    me = session['user_id']
    if not are_friends(me, uid):
        return jsonify([])
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT id,media_url,msg_type,timestamp FROM messages
        WHERE ((sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s))
        AND msg_type IN ('image','video') AND deleted=FALSE AND media_url IS NOT NULL
        ORDER BY timestamp DESC''', (me, uid, uid, me))
    rows = cur.fetchall()
    cur.close(); conn.close()
    return jsonify([{'id': r['id'], 'url': r['media_url'],
                     'type': r['msg_type'], 'timestamp': str(r['timestamp'])} for r in rows])


# ── Polls ─────────────────────────────────────────────────────

@app.route('/poll/vote/<int:msg_id>', methods=['POST'])
def vote_poll(msg_id):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    option_index = str(request.json.get('option_index', 0))
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT * FROM polls WHERE msg_id=%s', (msg_id,))
    poll = cur.fetchone()
    if not poll:
        cur.close(); conn.close()
        return jsonify({'ok': False})
    votes = dict(poll['votes'] or {})
    # Remove existing vote from this user
    for k in list(votes.keys()):
        if me in votes[k]:
            votes[k].remove(me)
    # Cast new vote
    if option_index not in votes:
        votes[option_index] = []
    votes[option_index].append(me)
    cur.execute('UPDATE polls SET votes=%s WHERE msg_id=%s',
                (psycopg2.extras.Json(votes), msg_id))
    conn.commit()
    cur.execute('SELECT sender, receiver FROM messages WHERE id=%s', (msg_id,))
    msg = cur.fetchone()
    cur.close(); conn.close()
    payload = {'msg_id': msg_id, 'votes': votes}
    if msg:
        for uid in [msg['sender'], msg['receiver']]:
            if uid in connected_users:
                socketio.emit('poll_vote', payload, to=connected_users[uid])
    return jsonify({'ok': True, 'votes': votes})


# ── Pin Messages ──────────────────────────────────────────────

@app.route('/pinned/<other>')
def get_pinned(other):
    if 'user_id' not in session:
        return jsonify({})
    me = session['user_id']
    u1, u2 = get_chat_key(me, other)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT * FROM pinned_messages WHERE user1=%s AND user2=%s', (u1, u2))
    row = cur.fetchone()
    cur.close(); conn.close()
    return jsonify(dict(row) if row else {})


@app.route('/pin_message', methods=['POST'])
def pin_message():
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    data = request.json
    other = data.get('other')
    if not other or not are_friends(me, other):
        return jsonify({'ok': False})
    u1, u2 = get_chat_key(me, other)
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''INSERT INTO pinned_messages (user1,user2,msg_id,msg_text,msg_type,media_url)
        VALUES (%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user1,user2) DO UPDATE SET
        msg_id=EXCLUDED.msg_id, msg_text=EXCLUDED.msg_text,
        msg_type=EXCLUDED.msg_type, media_url=EXCLUDED.media_url''',
        (u1, u2, data.get('msg_id'), data.get('msg_text', ''),
         data.get('msg_type', 'text'), data.get('media_url', '')))
    conn.commit()
    cur.close(); conn.close()
    payload = {
        'msg_id': data.get('msg_id'),
        'msg_text': data.get('msg_text', ''),
        'msg_type': data.get('msg_type', 'text')
    }
    if other in connected_users:
        socketio.emit('pin_update', payload, to=connected_users[other])
    return jsonify({'ok': True})


@app.route('/unpin_message/<other>', methods=['DELETE'])
def unpin_message(other):
    if 'user_id' not in session:
        return jsonify({'ok': False})
    me = session['user_id']
    u1, u2 = get_chat_key(me, other)
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM pinned_messages WHERE user1=%s AND user2=%s', (u1, u2))
    conn.commit()
    cur.close(); conn.close()
    if other in connected_users:
        socketio.emit('pin_update', {'msg_id': None}, to=connected_users[other])
    return jsonify({'ok': True})


# ── Rich Link Preview ─────────────────────────────────────────

@app.route('/link_preview')
def link_preview():
    if 'user_id' not in session:
        return jsonify({})
    url = request.args.get('url', '').strip()
    if not url or not url.startswith(('http://', 'https://')):
        return jsonify({})
    try:
        import urllib.request as ureq
        req = ureq.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Chatly/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
        })
        with ureq.urlopen(req, timeout=5) as resp:
            raw = resp.read(65536)
        html = raw.decode('utf-8', errors='ignore')

        def og(prop):
            for pat in [
                rf'<meta[^>]+property=["\']og:{prop}["\'][^>]+content=["\']([^"\']*)["\']',
                rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]+property=["\']og:{prop}["\']',
            ]:
                m = re.search(pat, html, re.I)
                if m:
                    return m.group(1).strip()
            return ''

        title = og('title')
        if not title:
            m = re.search(r'<title[^>]*>([^<]*)</title>', html, re.I)
            title = m.group(1).strip() if m else ''

        return jsonify({
            'title': title[:120],
            'description': og('description')[:220],
            'image': og('image'),
            'url': url,
        })
    except Exception:
        return jsonify({})


# ── Socket Events ─────────────────────────────────────────────

@socketio.on('connect')
def handle_connect():
    if 'user_id' in session:
        connected_users[session['user_id']] = request.sid
        emit('user_list_update', list(connected_users.keys()), broadcast=True)


@socketio.on('disconnect')
def handle_disconnect():
    if 'user_id' in session:
        connected_users.pop(session['user_id'], None)
        emit('user_list_update', list(connected_users.keys()), broadcast=True)


@socketio.on('typing')
def handle_typing(data):
    sender = session.get('user_id')
    receiver = data.get('receiver')
    if receiver in connected_users:
        emit('typing', {'sender': sender, 'typing': data.get('typing', False)},
             to=connected_users[receiver])


@socketio.on('private_message')
def handle_private(data):
    sender = session['user_id']
    receiver = data['receiver']
    if not are_friends(sender, receiver):
        return
    message = data.get('message', '')
    sender_message = data.get('sender_message', '')
    msg_type = data.get('msg_type', 'text')
    media_url = data.get('media_url', '')
    reply_to = data.get('reply_to', '')
    poll_question = data.get('poll_question', '')
    poll_options = data.get('poll_options', [])

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    u1, u2 = get_chat_key(sender, receiver)
    cur.execute('SELECT disappear_timer FROM chat_settings WHERE user1=%s AND user2=%s', (u1, u2))
    settings = cur.fetchone()
    disappear_at = None
    if settings and settings['disappear_timer'] > 0:
        disappear_at = datetime.utcnow() + timedelta(seconds=settings['disappear_timer'])

    now = datetime.utcnow()
    cur.execute('''INSERT INTO messages
        (sender,receiver,message,sender_message,msg_type,media_url,reply_to,disappear_at,delivered_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
        (sender, receiver, message, sender_message, msg_type,
         media_url, reply_to, disappear_at, now))
    msg_id = cur.fetchone()['id']

    poll_data = None
    if msg_type == 'poll' and poll_question and poll_options:
        cur.execute('INSERT INTO polls (msg_id, question, options, votes) VALUES (%s,%s,%s,%s)',
                    (msg_id, poll_question,
                     psycopg2.extras.Json(poll_options),
                     psycopg2.extras.Json({})))
        poll_data = {'question': poll_question, 'options': poll_options, 'votes': {}}

    conn.commit()
    cur.close(); conn.close()

    delivered_str = now.strftime('%I:%M %p')
    base = {
        'id': msg_id, 'sender': sender, 'msg_type': msg_type,
        'media_url': media_url, 'reply_to': reply_to,
        'delivered_at': delivered_str,
    }
    if poll_data:
        base['poll'] = poll_data

    if receiver in connected_users:
        emit('private_message', {**base, 'message': message}, to=connected_users[receiver])
    emit('private_message', {**base, 'message': sender_message, 'is_own': True}, to=request.sid)


@socketio.on('seen')
def handle_seen(data):
    me = session.get('user_id')
    sender = data.get('sender')
    now = datetime.utcnow()
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''UPDATE messages SET seen=TRUE, seen_at=%s
        WHERE sender=%s AND receiver=%s AND seen=FALSE''', (now, sender, me))
    conn.commit()
    cur.close(); conn.close()
    if sender in connected_users:
        emit('seen', {'by': me, 'seen_at': now.strftime('%I:%M %p')},
             to=connected_users[sender])


# ── Admin Utils ───────────────────────────────────────────────

@app.route('/nuke')
def nuke():
    conn = get_db()
    cur = conn.cursor()
    for tbl in ['messages', 'friend_requests', 'users', 'chat_settings', 'polls', 'pinned_messages']:
        cur.execute(f'DELETE FROM {tbl}')
    conn.commit()
    cur.close(); conn.close()
    session.clear()
    return 'wiped'


@app.route('/reset_db')
def reset_db():
    conn = get_db()
    cur = conn.cursor()
    for tbl in ['messages', 'friend_requests', 'chat_settings', 'users', 'polls', 'pinned_messages']:
        cur.execute(f'DROP TABLE IF EXISTS {tbl} CASCADE')
    conn.commit()
    cur.close()
    conn.close()
    init_db()
    return 'DB reset done'


if __name__ == '__main__':
    socketio.run(app, debug=True)
