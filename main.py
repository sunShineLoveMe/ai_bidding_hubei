from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
from dotenv import load_dotenv
import sqlite3
from datetime import datetime
import uuid
import json

# 加载环境变量
load_dotenv()

app = Flask(__name__)
CORS(app)

# 配置
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['GENERATED_FOLDER'] = 'outputs'
app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_UPLOAD_MB', '200')) * 1024 * 1024

# 确保上传目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['GENERATED_FOLDER'], exist_ok=True)

# 数据库初始化
def init_db():
    conn = sqlite3.connect('bidding.db')
    cursor = conn.cursor()
    
    # 创建用户表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fingerprint_id TEXT UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 创建招投标文件表
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bidding (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            original_filename TEXT NOT NULL,
            storage_path TEXT NOT NULL,
            document_key TEXT UNIQUE NOT NULL,
            status TEXT DEFAULT '已上传',
            other_response_format TEXT,
            bid_document TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS onlyoffice_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_key TEXT UNIQUE NOT NULL,
            project_id TEXT,
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            download_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

# 初始化数据库
init_db()

import routes
import users

# 注册蓝图
app.register_blueprint(routes.bp, url_prefix='/api/bidding')
app.register_blueprint(routes.knowledge_bp, url_prefix='/api/knowledge')
app.register_blueprint(users.bp, url_prefix='/api/users')

@app.route('/api/outputs/<path:filename>')
def output_file(filename):
    file_path = os.path.join(app.config['GENERATED_FOLDER'], filename)
    print(f"输出文件访问: {file_path}, Exists: {os.path.exists(file_path)}")
    return send_from_directory(app.config['GENERATED_FOLDER'], filename)

@app.route('/assets/<path:filename>')
def asset_file(filename):
    dist_assets = os.path.join('frontend', 'dist', 'assets')
    dist_asset_path = os.path.join(dist_assets, filename)
    if os.path.exists(dist_asset_path):
        return send_from_directory(dist_assets, filename)
    public_assets = os.path.join('frontend', 'public', 'assets')
    public_asset_path = os.path.join(public_assets, filename)
    if os.path.exists(public_asset_path):
        return send_from_directory(public_assets, filename)
    return send_from_directory('assets', filename)

@app.route('/')
@app.route('/bidding')
@app.route('/interpretation')
@app.route('/bid-editor')
@app.route('/onlyoffice-editor')
@app.route('/knowledge')
@app.route('/qualification')
@app.route('/products')
@app.route('/settings')
@app.route('/history')
def bidding_workbench():
    dist_index = os.path.join('frontend', 'dist', 'index.html')
    if os.path.exists(dist_index):
        return send_from_directory(os.path.join('frontend', 'dist'), 'index.html')
    return jsonify({
        'error': '前端 Vite 构建产物不存在。请进入 frontend 执行 npm install && npm run build，或开发时运行 npm run dev。'
    }), 503

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3012))
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug_mode) 
