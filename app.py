import os
from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import psycopg2
import psycopg2.extras
import time
from collections import defaultdict

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey123'
socketio = SocketIO(app, cors_allowed_origins="*")


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
        username TEXT UNIQUE NOT NULL,
        user_id TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        public_key TEXT,
        avatar_url TEXT,
        wallpaper_url TEXT
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        message TEXT,
        sender_message TEXT,
        msg_type TEXT DEFAULT 'text',
        media_url TEXT,
        reply_to TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS friend_requests (
        id SERIAL PRIMARY KEY,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        UNIQUE(sender, receiver)
    )''')
    cur.execute('''ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT''')
    cur.execute('''ALTER TABLE users ADD COLUMN IF NOT EXISTS wallpaper_url TEXT''')
    cur.execute('''ALTER TABLE users ADD COLUMN IF NOT EXISTS user_id TEXT''')
    cur.execute('''ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_message TEXT''')
    cur.execute('''ALTER TABLE messages ADD COLUMN IF NOT EXISTS msg_type TEXT DEFAULT 'text' ''')
    cur.execute('''ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT''')
    cur.execute('''ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to TEXT''')
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
    cur.execute('''SELECT * FROM friend_requests 
        WHERE ((sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)) AND status='accepted'
    ''', (a, b, b, a))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row is not None

def generate_user_id():
    import random, string
    return ''.join(random.choices(string.digits, k=4))

init_db()

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
            return render_template('login.html', error=f'Too many attempts. Wait {BLOCK_TIME} seconds.')
        username = request.form['username']
        password = request.form['password']
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT * FROM users WHERE username = %s', (username,))
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
        hashed = generate_password_hash(password)
        uid = generate_user_id()
        try:
            conn = get_db()
            cur = conn.cursor()
            cur.execute('INSERT INTO users (username, user_id, password) VALUES (%s, %s, %s)', (username, uid, hashed))
            conn.commit()
            cur.close()
            conn.close()
            session['username'] = username
            return redirect(url_for('index'))
        except psycopg2.IntegrityError:
            conn.rollback()
            cur.close()
            conn.close()
            error = 'Username already taken'
    return render_template('signup.html', error=error)

@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('index'))

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
    if row and row['public_key']:
        return jsonify({'key': row['public_key']})
    return jsonify({'key': None})

@app.route('/profile')
def get_profile():
    if 'username' not in session:
        return jsonify({})
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT username, user_id, avatar_url, wallpaper_url FROM users WHERE username=%s', (session['username'],))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify(dict(row))

@app.route('/profile/<username>')
def get_user_profile(username):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT username, user_id, avatar_url FROM users WHERE username=%s', (username,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if row:
        return jsonify(dict(row))
    return jsonify({})

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

@app.route('/users')
def get_users():
    if 'username' not in session:
        return jsonify([])
    q = request.args.get('q', '').lower()
    me = session['username']
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    # Get friend usernames
    cur.execute('''SELECT CASE WHEN sender=%s THEN receiver ELSE sender END as friend
        FROM friend_requests WHERE (sender=%s OR receiver=%s) AND status='accepted' ''', (me, me, me))
    friends = {r['friend'] for r in cur.fetchall()}
    cur.execute('SELECT username, user_id, avatar_url FROM users WHERE username != %s', (me,))
    users = cur.fetchall()
    cur.close()
    conn.close()
    online = list(connected_users.keys())
    result = []
    for u in users:
        if u['username'] in friends:
            continue  # hide already friends
        if q and q not in u['username'].lower() and q not in (u['user_id'] or '').lower():
            continue
        result.append({'username': u['username'], 'user_id': u['user_id'], 'avatar_url': u['avatar_url'], 'online': u['username'] in online})
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
    friends = [r['friend'] for r in rows]
    result = []
    for f in friends:
        cur.execute('SELECT username, user_id, avatar_url FROM users WHERE username=%s', (f,))
        u = cur.fetchone()
        if u:
            result.append({'username': u['username'], 'user_id': u['user_id'], 'avatar_url': u['avatar_url'], 'online': f in connected_users})
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
        cur.execute('INSERT INTO friend_requests (sender, receiver) VALUES (%s, %s)', (me, to))
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
        WHERE ((sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s))''', (me, other, other, me))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'ok': True})

@app.route('/history/<other>')
def history(other):
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    if not are_friends(me, other):
        return jsonify([])
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('''SELECT sender, message, sender_message, msg_type, media_url, reply_to, timestamp 
        FROM messages WHERE (sender=%s AND receiver=%s) OR (sender=%s AND receiver=%s)
        ORDER BY timestamp ASC''', (me, other, other, me))
    msgs = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([{
        'sender': m['sender'],
        'message': m['message'],
        'sender_message': m['sender_message'],
        'msg_type': m['msg_type'],
        'media_url': m['media_url'],
        'reply_to': m['reply_to'],
        'timestamp': str(m['timestamp'])
    } for m in msgs])

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

@socketio.on('private_message')
def handle_private(data):
    sender = session['username']
    receiver = data['receiver']
    message = data.get('message', '')
    sender_message = data.get('sender_message', '')
    msg_type = data.get('msg_type', 'text')
    media_url = data.get('media_url', '')
    reply_to = data.get('reply_to', '')
    if not are_friends(sender, receiver):
        return
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''INSERT INTO messages (sender, receiver, message, sender_message, msg_type, media_url, reply_to) 
        VALUES (%s, %s, %s, %s, %s, %s, %s)''',
        (sender, receiver, message, sender_message, msg_type, media_url, reply_to))
    conn.commit()
    cur.close()
    conn.close()
    if receiver in connected_users:
        emit('private_message', {
            'sender': sender, 'message': message,
            'msg_type': msg_type, 'media_url': media_url, 'reply_to': reply_to
        }, to=connected_users[receiver])
    emit('private_message', {
        'sender': sender, 'message': sender_message, 'is_own': True,
        'msg_type': msg_type, 'media_url': media_url, 'reply_to': reply_to
    }, to=request.sid)

@app.route('/nuke')
def nuke():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('DELETE FROM messages')
    cur.execute('DELETE FROM friend_requests')
    cur.execute('DELETE FROM users')
    conn.commit()
    cur.close()
    conn.close()
    session.clear()
    return 'wiped'

if __name__ == '__main__':
    socketio.run(app, debug=True)
