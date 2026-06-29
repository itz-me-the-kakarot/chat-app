import os
import time
import random
import string
from collections import defaultdict
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import psycopg2
import psycopg2.extras

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey123'
socketio = SocketIO(app, cors_allowed_origins="*")

connected_users = {}   # username -> sid
typing_users = {}      # username -> who they're typing to
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
        username TEXT UNIQUE NOT NULL,
        display_name TEXT,
        user_id TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        public_key TEXT,
        avatar_url TEXT,
        wallpaper_url TEXT
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
    # Migrations for existing DBs
    for col in [
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT',
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS wallpaper_url TEXT',
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_message TEXT',
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type TEXT DEFAULT \'text\'',
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT',
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to TEXT',
        "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}'",
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE',
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS disappear_at TIMESTAMP',
        'ALTER TABLE messages ADD COLUMN IF NOT EXISTS seen BOOLEAN DEFAULT FALSE',
    ]:
        try:
            cur.execute(col)
        except Exception:
            conn.rollback()
    conn.commit()
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

init_db()

# ── Auth ──────────────────────────────────────────────────────
@app.route('/')
def index():
    if 'username' not in session:
        return render_template('landing.html')
    return render_template('index.html', username=session['username'])

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        ip = request.remote_addr
        if is_rate_limited(ip):
            return render_template('login.html', error=f'Too many attempts. Wait {BLOCK_TIME}s.')
        username = request.form['username']
        password = request.form['password']
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT * FROM users WHERE username=%s', (username,))
        user = cur.fetchone()
        cur.close()
        conn.close()
        if user and check_password_hash(user['password'], password):
            session['username'] = username
            return redirect(url_for('index'))
        record_attempt(ip)
        time.sleep(1)
        error = 'Invalid username or password'
    return render_template('login.html', error=error)

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        user_id = request.form.get('user_id', '').strip()
        display_name = request.form.get('display_name', username).strip() or username
        if not user_id.isdigit() or len(user_id) < 4:
            error = 'User ID must be at least 4 digits'
            return render_template('signup.html', error=error)
        hashed = generate_password_hash(password)
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute('INSERT INTO users (username, display_name, user_id, password) VALUES (%s,%s,%s,%s)',
                        (username, display_name, user_id, hashed))
            conn.commit()
            cur.close()
            conn.close()
            session['username'] = username
            return redirect(url_for('index'))
        except psycopg2.IntegrityError as e:
            conn.rollback()
            cur.close()
            conn.close()
            if 'user_id' in str(e):
                error = 'That User ID is already taken'
            else:
                error = 'Username already taken'
    return render_template('signup.html', error=error)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/reset_pw/<username>/<newpw>')
def reset_pw(username, newpw):
    hashed = generate_password_hash(newpw)
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET password=%s WHERE username=%s', (hashed, username))
    conn.commit()
    cur.close()
    conn.close()
    return 'done'

# ── Keys ──────────────────────────────────────────────────────
@app.route('/save_key', methods=['POST'])
def save_key():
    if 'username' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET public_key=%s WHERE username=%s', (data['key'], session['username']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

@app.route('/pubkey/<username>')
def pubkey(username):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT public_key FROM users WHERE username=%s', (username,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({'key': row['public_key'] if row and row['public_key'] else None})

# ── Profile ───────────────────────────────────────────────────
@app.route('/profile')
def get_profile():
    if 'username' not in session:
        return jsonify({})
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT username, display_name, user_id, avatar_url, wallpaper_url FROM users WHERE username=%s', (session['username'],))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(row))

@app.route('/profile/<username>')
def get_user_profile(username):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT username, display_name, user_id, avatar_url FROM users WHERE username=%s', (username,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(row) if row else {})

@app.route('/update_profile', methods=['POST'])
def update_profile():
    if 'username' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    if 'display_name' in data:
        cur.execute('UPDATE users SET display_name=%s WHERE username=%s', (data['display_name'], session['username']))
    if 'avatar_url' in data:
        cur.execute('UPDATE users SET avatar_url=%s WHERE username=%s', (data['avatar_url'], session['username']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

# ── Chat settings ─────────────────────────────────────────────
@app.route('/chat_settings/<other>')
def get_chat_settings(other):
    if 'username' not in session:
        return jsonify({})
    me = session['username']
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
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    data = request.json
    u1, u2 = get_chat_key(me, other)
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''INSERT INTO chat_settings (user1, user2, wallpaper_url, disappear_timer)
        VALUES (%s,%s,%s,%s)
        ON CONFLICT (user1,user2) DO UPDATE SET
        wallpaper_url=EXCLUDED.wallpaper_url,
        disappear_timer=EXCLUDED.disappear_timer''',
        (u1, u2, data.get('wallpaper_url'), data.get('disappear_timer', 0)))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

# ── Upload (URL save) ─────────────────────────────────────────
@app.route('/upload_avatar', methods=['POST'])
def upload_avatar():
    if 'username' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET avatar_url=%s WHERE username=%s', (data['url'], session['username']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

@app.route('/upload_wallpaper', methods=['POST'])
def upload_wallpaper():
    if 'username' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE users SET wallpaper_url=%s WHERE username=%s', (data['url'], session['username']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

@app.route('/upload_media', methods=['POST'])
def upload_media():
    if 'username' not in session:
        return jsonify({'ok': False})
    data = request.json
    return jsonify({'ok': True, 'url': data['url'], 'type': data['type']})

# ── Users & Friends ───────────────────────────────────────────
@app.route('/users')
def get_users():
    if 'username' not in session:
        return jsonify([])
    q = request.args.get('q', '').lower()
    me = session['username']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT CASE WHEN sender=%s THEN receiver ELSE sender END as friend
        FROM friend_requests WHERE (sender=%s OR receiver=%s) AND status='accepted' ''', (me, me, me))
    friends = {r['friend'] for r in cur.fetchall()}
    cur.execute('SELECT username, display_name, user_id, avatar_url FROM users WHERE username != %s', (me,))
    users = cur.fetchall()
    cur.close()
    conn.close()
    online = list(connected_users.keys())
    result = []
    for u in users:
        if u['username'] in friends:
            continue
        if q and q not in (u['username'] or '').lower() and q not in (u['user_id'] or '').lower() and q not in (u['display_name'] or '').lower():
            continue
        result.append({'username': u['username'], 'display_name': u['display_name'] or u['username'],
                       'user_id': u['user_id'], 'avatar_url': u['avatar_url'], 'online': u['username'] in online})
    return jsonify(result)

@app.route('/friends')
def get_friends():
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT CASE WHEN sender=%s THEN receiver ELSE sender END as friend
        FROM friend_requests WHERE (sender=%s OR receiver=%s) AND status='accepted' ''', (me, me, me))
    rows = cur.fetchall()
    result = []
    for r in rows:
        f = r['friend']
        cur.execute('SELECT username, display_name, user_id, avatar_url FROM users WHERE username=%s', (f,))
        u = cur.fetchone()
        if u:
            result.append({'username': u['username'], 'display_name': u['display_name'] or u['username'],
                           'user_id': u['user_id'], 'avatar_url': u['avatar_url'], 'online': f in connected_users})
    cur.close()
    conn.close()
    return jsonify(result)

@app.route('/friend_requests')
def get_friend_requests():
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT sender FROM friend_requests WHERE receiver=%s AND status=%s', (me, 'pending'))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([r['sender'] for r in rows])

@app.route('/send_request/<to>', methods=['POST'])
def send_request(to):
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('INSERT INTO friend_requests (sender, receiver) VALUES (%s,%s)', (me, to))
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
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    status = 'accepted' if action == 'accept' else 'rejected'
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE friend_requests SET status=%s WHERE sender=%s AND receiver=%s', (status, from_user, me))
    conn.commit()
    cur.close()
    conn.close()
    if status == 'accepted' and from_user in connected_users:
        socketio.emit('request_accepted', {'by': me}, to=connected_users[from_user])
    return jsonify({'ok': True})

@app.route('/remove_friend/<other>', methods=['POST'])
def remove_friend(other):
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''DELETE FROM friend_requests 
        WHERE (sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)''', (me, other, other, me))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

# ── Messages ──────────────────────────────────────────────────
@app.route('/history/<other>')
def history(other):
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    if not are_friends(me, other):
        return jsonify([])
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT id, sender, message, sender_message, msg_type, media_url, reply_to,
        reactions, deleted, seen, timestamp FROM messages
        WHERE (sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)
        ORDER BY timestamp ASC''', (me, other, other, me))
    msgs = cur.fetchall()
    # Mark as seen
    cur.execute('''UPDATE messages SET seen=TRUE WHERE sender=%s AND receiver=%s AND seen=FALSE''', (other, me))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify([{
        'id': m['id'], 'sender': m['sender'],
        'message': m['message'], 'sender_message': m['sender_message'],
        'msg_type': m['msg_type'], 'media_url': m['media_url'],
        'reply_to': m['reply_to'], 'reactions': m['reactions'] or {},
        'deleted': m['deleted'], 'seen': m['seen'],
        'timestamp': str(m['timestamp'])
    } for m in msgs])

@app.route('/delete_message/<int:msg_id>', methods=['POST'])
def delete_message(msg_id):
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT sender, receiver FROM messages WHERE id=%s', (msg_id,))
    msg = cur.fetchone()
    if not msg or msg['sender'] != me:
        cur.close()
        conn.close()
        return jsonify({'ok': False})
    cur.execute('UPDATE messages SET deleted=TRUE, message=NULL, sender_message=NULL, media_url=NULL WHERE id=%s', (msg_id,))
    conn.commit()
    receiver = msg['receiver']
    cur.close()
    conn.close()
    if receiver in connected_users:
        socketio.emit('message_deleted', {'id': msg_id}, to=connected_users[receiver])
    socketio.emit('message_deleted', {'id': msg_id}, to=connected_users.get(me))
    return jsonify({'ok': True})

@app.route('/react/<int:msg_id>', methods=['POST'])
def react(msg_id):
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    emoji = request.json.get('emoji')
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT reactions, sender, receiver FROM messages WHERE id=%s', (msg_id,))
    msg = cur.fetchone()
    if not msg:
        cur.close()
        conn.close()
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
    cur.execute('UPDATE messages SET reactions=%s WHERE id=%s', (psycopg2.extras.Json(reactions), msg_id))
    conn.commit()
    other = msg['receiver'] if msg['sender'] == me else msg['sender']
    cur.close()
    conn.close()
    payload = {'msg_id': msg_id, 'reactions': reactions}
    if other in connected_users:
        socketio.emit('reaction_update', payload, to=connected_users[other])
    socketio.emit('reaction_update', payload, to=connected_users.get(me))
    return jsonify({'ok': True, 'reactions': reactions})

# ── Sockets ───────────────────────────────────────────────────
@socketio.on('connect')
def handle_connect():
    if 'username' in session:
        connected_users[session['username']] = request.sid
        emit('user_list_update', list(connected_users.keys()), broadcast=True)

@socketio.on('disconnect')
def handle_disconnect():
    if 'username' in session:
        connected_users.pop(session['username'], None)
        emit('user_list_update', list(connected_users.keys()), broadcast=True)

@socketio.on('typing')
def handle_typing(data):
    sender = session.get('username')
    receiver = data.get('receiver')
    is_typing = data.get('typing', False)
    if receiver in connected_users:
        emit('typing', {'sender': sender, 'typing': is_typing}, to=connected_users[receiver])

@socketio.on('private_message')
def handle_private(data):
    sender = session['username']
    receiver = data['receiver']
    if not are_friends(sender, receiver):
        return
    message = data.get('message', '')
    sender_message = data.get('sender_message', '')
    msg_type = data.get('msg_type', 'text')
    media_url = data.get('media_url', '')
    reply_to = data.get('reply_to', '')

    # Disappearing messages
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    u1, u2 = get_chat_key(sender, receiver)
    cur.execute('SELECT disappear_timer FROM chat_settings WHERE user1=%s AND user2=%s', (u1, u2))
    settings = cur.fetchone()
    disappear_at = None
    if settings and settings['disappear_timer'] > 0:
        from datetime import datetime, timedelta
        disappear_at = datetime.utcnow() + timedelta(seconds=settings['disappear_timer'])

    cur.execute('''INSERT INTO messages (sender, receiver, message, sender_message, msg_type, media_url, reply_to, disappear_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
        (sender, receiver, message, sender_message, msg_type, media_url, reply_to, disappear_at))
    msg_id = cur.fetchone()['id']
    conn.commit()
    cur.close()
    conn.close()

    payload = {'id': msg_id, 'sender': sender, 'message': message,
               'msg_type': msg_type, 'media_url': media_url, 'reply_to': reply_to}
    if receiver in connected_users:
        emit('private_message', payload, to=connected_users[receiver])
    emit('private_message', {'id': msg_id, 'sender': sender, 'message': sender_message,
                              'is_own': True, 'msg_type': msg_type, 'media_url': media_url,
                              'reply_to': reply_to}, to=request.sid)

@socketio.on('seen')
def handle_seen(data):
    me = session.get('username')
    sender = data.get('sender')
    conn = get_db()
    cur = conn.cursor()
    cur.execute('UPDATE messages SET seen=TRUE WHERE sender=%s AND receiver=%s AND seen=FALSE', (sender, me))
    conn.commit()
    cur.close()
    conn.close()
    if sender in connected_users:
        emit('seen', {'by': me}, to=connected_users[sender])

@app.route('/media/<username>')
def get_media(username):
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    if not are_friends(me, username):
        return jsonify([])
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT id, media_url, msg_type, timestamp FROM messages
        WHERE ((sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s))
        AND msg_type IN ('image','video') AND deleted=FALSE AND media_url IS NOT NULL
        ORDER BY timestamp DESC''', (me, username, username, me))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([{'id': r['id'], 'url': r['media_url'], 'type': r['msg_type'], 'timestamp': str(r['timestamp'])} for r in rows])

@app.route('/nuke')
def nuke():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM messages')
    cur.execute('DELETE FROM friend_requests')
    cur.execute('DELETE FROM users')
    cur.execute('DELETE FROM chat_settings')
    conn.commit()
    cur.close()
    conn.close()
    session.clear()
    return 'wiped'

if __name__ == '__main__':
    socketio.run(app, debug=True)
