from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import time
from collections import defaultdict

app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey123'
socketio = SocketIO(app, cors_allowed_origins="*")

connected_users = {}  # username -> socket id
login_attempts = defaultdict(list)  # ip -> [timestamps]

RATE_LIMIT = 10       # max attempts
BLOCK_TIME = 10       # seconds

def get_db():
    conn = sqlite3.connect('chat.db', check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        public_key TEXT
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        UNIQUE(sender, receiver)
    )''')
    conn.commit()
    conn.close()

def is_rate_limited(ip):
    now = time.time()
    attempts = login_attempts[ip]
    attempts = [t for t in attempts if now - t < BLOCK_TIME]
    login_attempts[ip] = attempts
    return len(attempts) >= RATE_LIMIT

def record_attempt(ip):
    login_attempts[ip].append(time.time())

def are_friends(a, b):
    conn = get_db()
    row = conn.execute('''SELECT * FROM friend_requests 
        WHERE ((sender=? AND receiver=?) OR (sender=? AND receiver=?)) AND status="accepted"
    ''', (a, b, b, a)).fetchone()
    conn.close()
    return row is not None

@app.route('/')
def index():
    if 'username' not in session:
        return redirect(url_for('login'))
    return render_template('index.html', username=session['username'])

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        ip = request.remote_addr
        if is_rate_limited(ip):
            error = f'Too many attempts. Wait {BLOCK_TIME} seconds.'
            return render_template('login.html', error=error)
        username = request.form['username']
        password = request.form['password']
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        conn.close()
        if user and check_password_hash(user['password'], password):
            session['username'] = username
            return redirect(url_for('index'))
        record_attempt(ip)
        time.sleep(1)  # fake delay
        error = 'Invalid username or password'
    return render_template('login.html', error=error)

@app.route('/signup', methods=['GET', 'POST'])
def signup():
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        hashed = generate_password_hash(password)
        try:
            conn = get_db()
            conn.execute('INSERT INTO users (username, password) VALUES (?, ?)', (username, hashed))
            conn.commit()
            conn.close()
            session['username'] = username
            return redirect(url_for('index'))
        except sqlite3.IntegrityError:
            error = 'Username already taken'
    return render_template('signup.html', error=error)

@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login'))

# Save public key after keygen on client
@app.route('/save_key', methods=['POST'])
def save_key():
    if 'username' not in session:
        return jsonify({'ok': False})
    data = request.json
    conn = get_db()
    conn.execute('UPDATE users SET public_key=? WHERE username=?', (data['key'], session['username']))
    conn.commit()
    conn.close()
    return jsonify({'ok': True})

# Get someone's public key for encryption
@app.route('/pubkey/<username>')
def pubkey(username):
    conn = get_db()
    row = conn.execute('SELECT public_key FROM users WHERE username=?', (username,)).fetchone()
    conn.close()
    if row and row['public_key']:
        return jsonify({'key': row['public_key']})
    return jsonify({'key': None})

@app.route('/users')
def get_users():
    if 'username' not in session:
        return jsonify([])
    q = request.args.get('q', '').lower()
    conn = get_db()
    users = conn.execute('SELECT username FROM users WHERE username != ?', (session['username'],)).fetchall()
    conn.close()
    online = list(connected_users.keys())
    result = []
    for u in users:
        uname = u['username']
        if q and q not in uname.lower():
            continue
        result.append({'username': uname, 'online': uname in online})
    return jsonify(result)

@app.route('/friends')
def get_friends():
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    conn = get_db()
    rows = conn.execute('''
        SELECT CASE WHEN sender=? THEN receiver ELSE sender END as friend
        FROM friend_requests
        WHERE (sender=? OR receiver=?) AND status="accepted"
    ''', (me, me, me)).fetchall()
    conn.close()
    online = list(connected_users.keys())
    return jsonify([{'username': r['friend'], 'online': r['friend'] in online} for r in rows])

@app.route('/friend_requests')
def get_friend_requests():
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    conn = get_db()
    rows = conn.execute('''
        SELECT sender FROM friend_requests WHERE receiver=? AND status="pending"
    ''', (me,)).fetchall()
    conn.close()
    return jsonify([r['sender'] for r in rows])

@app.route('/send_request/<to>', methods=['POST'])
def send_request(to):
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    try:
        conn = get_db()
        conn.execute('INSERT INTO friend_requests (sender, receiver) VALUES (?, ?)', (me, to))
        conn.commit()
        conn.close()
        # Notify receiver if online
        if to in connected_users:
            socketio.emit('friend_request', {'from': me}, to=connected_users[to])
        return jsonify({'ok': True})
    except sqlite3.IntegrityError:
        return jsonify({'ok': False, 'error': 'Already sent'})

@app.route('/respond_request/<from_user>/<action>', methods=['POST'])
def respond_request(from_user, action):
    if 'username' not in session:
        return jsonify({'ok': False})
    me = session['username']
    status = 'accepted' if action == 'accept' else 'rejected'
    conn = get_db()
    conn.execute('UPDATE friend_requests SET status=? WHERE sender=? AND receiver=?', (status, from_user, me))
    conn.commit()
    conn.close()
    if status == 'accepted' and from_user in connected_users:
        socketio.emit('request_accepted', {'by': me}, to=connected_users[from_user])
    return jsonify({'ok': True})

@app.route('/history/<other>')
def history(other):
    if 'username' not in session:
        return jsonify([])
    me = session['username']
    if not are_friends(me, other):
        return jsonify([])
    conn = get_db()
    msgs = conn.execute('''
        SELECT sender, message, timestamp FROM messages
        WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)
        ORDER BY timestamp ASC
    ''', (me, other, other, me)).fetchall()
    conn.close()
    return jsonify([{'sender': m['sender'], 'message': m['message'], 'timestamp': m['timestamp']} for m in msgs])

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
    message = data['message']  # already encrypted on client
    if not are_friends(sender, receiver):
        return
    conn = get_db()
    conn.execute('INSERT INTO messages (sender, receiver, message) VALUES (?, ?, ?)', (sender, receiver, message))
    conn.commit()
    conn.close()
    if receiver in connected_users:
        emit('private_message', {'sender': sender, 'message': message}, to=connected_users[receiver])
    emit('private_message', {'sender': sender, 'message': message}, to=request.sid)

init_db()

if __name__ == '__main__':
    socketio.run(app, debug=True)
