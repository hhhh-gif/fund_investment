import json
import re
import time
import datetime
import requests
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import logging
from collections import defaultdict

app = Flask(__name__)
CORS(app)

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)
app.config['JSON_AS_ASCII'] = False

# 全局缓存（仅保留实时监控相关）
monitor_cache = {
    "index_map": {"上证指数": "sh000001", "深证成指": "sz399001", "创业板指": "sz399006"},
    "fund_codes": ["000001", "025857", "161725"],  # 有效基金代码
    "refresh_interval": 30,
    # 实时监控历史数据（页面内实时刷新的历史，非历史业绩）
    "history": {
        "time": [], 
        "original_time": [], 
        "index_data": defaultdict(list), 
        "fund_data": defaultdict(list)
    },
    # 实时详情缓存
    "fund_detail_cache": {},
    "index_detail_cache": {},
    "last_update_time": None,
    # 增量更新缓存
    "incremental_data": {"indices": {}, "funds": {}}
}

# ===================== 实时监控核心函数 =====================
def get_index_detail(index_code, index_name):
    # 先检查缓存，30秒内不重复请求
    if index_name in monitor_cache["index_detail_cache"] and time.time() - monitor_cache["index_detail_cache"][index_name]["cache_time"] < 30:
        return monitor_cache["index_detail_cache"][index_name]["data"]
    
    # 修复请求头，模拟真实浏览器
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://finance.sina.com.cn/",
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive"
    }
    try:
        # 修复URL，去掉多余参数，使用标准格式
        url = f"https://hq.sinajs.cn/list={index_code}"
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()  # 检查HTTP状态码
        
        raw_data = resp.text.strip()
        if not raw_data:
            print(f"指数{index_name}返回空数据")
            return None
        
        # 解析数据
        data_part = raw_data.split('="')[-1].strip('";')
        data_list = data_part.split(',')
        
        if len(data_list) >= 32:  # 新浪返回数据长度足够
            current_price = float(data_list[3])   # 当前价
            pre_close = float(data_list[2])       # 昨收价
            change_amount = round(current_price - pre_close, 2)
            change = round((current_price - pre_close) / pre_close * 100, 2)
            
            detail = {
                "name": index_name,
                "code": index_code,
                "current_price": current_price,
                "pre_close": pre_close,
                "change_amount": change_amount,
                "change": change
            }
            monitor_cache["index_detail_cache"][index_name] = {"cache_time": time.time(), "data": detail}
            return detail
        else:
            print(f"指数{index_name}数据格式异常，长度：{len(data_list)}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"指数{index_name}请求失败：{str(e)}")
        return None
    except Exception as e:
        print(f"指数{index_name}解析失败：{str(e)}")
        return None

def get_fund_detail(fund_code):
    if fund_code in monitor_cache["fund_detail_cache"] and time.time() - monitor_cache["fund_detail_cache"][fund_code]["cache_time"] < 30:
        return monitor_cache["fund_detail_cache"][fund_code]["data"]
    
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://fund.eastmoney.com/",
        "Cache-Control": "no-cache"
    }
    try:
        # 添加时间戳避免缓存
        url = f"https://fundgz.1234567.com.cn/js/{fund_code}.js?rt={int(time.time() * 1000)}"
        resp = requests.get(url, headers=headers, timeout=8)
        match = re.search(r'\{.*\}', resp.text.strip())
        if not match:
            return None
        
        data = json.loads(match.group())
        detail = {
            "code": fund_code,
            "name": data.get("name", fund_code),
            "net_value": data.get("dwjz", "0.0000"),
            "estimate_value": data.get("gsz", "0.0000"),
            "estimate_change": data.get("gszzl", "0.00"),
            "update_time": data.get("gztime", ""),
            "change": float(data.get("gszzl", 0.00))
        }
        monitor_cache["fund_detail_cache"][fund_code] = {"cache_time": time.time(), "data": detail}
        return detail
    except Exception as e:
        print(f"获取基金{fund_code}详情失败：{e}")
        return None

def calculate_metrics(indices, funds):
    """重构指标计算：区分资产类型、过滤无效值、保留涨跌占比用于投资建议"""
    # 初始化分类统计字典
    stats = {
        "rising": {"indices": 0, "funds": 0, "total": 0},
        "falling": {"indices": 0, "funds": 0, "total": 0},
        "flat": {"indices": 0, "funds": 0, "total": 0}
    }
    # 初始化涨跌极值（只保留有效数据）
    max_rise = {"name": "", "value": -float('inf')}  # 初始化为负无穷
    max_fall = {"name": "", "value": float('inf')}   # 初始化为正无穷

    # 收集所有有效涨跌幅（用于计算整体市场趋势）
    all_changes = []

    # 处理指数数据
    for idx in indices:
        if not idx or "change" not in idx:
            continue
        change = idx["change"]
        name = idx["name"]
        all_changes.append(change)
        
        # 分类统计
        if change > 0:
            stats["rising"]["indices"] += 1
            stats["rising"]["total"] += 1
            # 更新最大涨幅
            if change > max_rise["value"]:
                max_rise = {"name": name, "value": change}
        elif change < 0:
            stats["falling"]["indices"] += 1
            stats["falling"]["total"] += 1
            # 更新最大跌幅
            if change < max_fall["value"]:
                max_fall = {"name": name, "value": change}
        else:
            stats["flat"]["indices"] += 1
            stats["flat"]["total"] += 1

    # 处理基金数据
    for fund in funds:
        if not fund or "change" not in fund:
            continue
        change = float(fund["change"])
        name = fund["name"]
        all_changes.append(change)
        
        # 分类统计
        if change > 0:
            stats["rising"]["funds"] += 1
            stats["rising"]["total"] += 1
            # 更新最大涨幅
            if change > max_rise["value"]:
                max_rise = {"name": name, "value": change}
        elif change < 0:
            stats["falling"]["funds"] += 1
            stats["falling"]["total"] += 1
            # 更新最大跌幅
            if change < max_fall["value"]:
                max_fall = {"name": name, "value": change}
        else:
            stats["flat"]["funds"] += 1
            stats["flat"]["total"] += 1

    # 计算整体市场平均涨跌幅（用于投资建议）
    avg_change = sum(all_changes) / len(all_changes) if all_changes else 0

    # 处理极值无数据的情况（返回null）
    if max_rise["value"] == -float('inf'):
        max_rise = {"name": "", "value": None}
    if max_fall["value"] == float('inf'):
        max_fall = {"name": "", "value": None}

    # 计算风险等级（基于总涨跌标的占比）
    total_targets = stats["rising"]["total"] + stats["falling"]["total"] + stats["flat"]["total"]
    if total_targets == 0:
        risk_level = "无数据（暂无监控标的）"
    else:
        rise_ratio = stats["rising"]["total"] / total_targets
        fall_ratio = stats["falling"]["total"] / total_targets
        
        if rise_ratio > 0.8:
            risk_level = "高风险（大涨）"
        elif rise_ratio > 0.5:
            risk_level = "中风险（小涨）"
        elif fall_ratio < 0.5:
            risk_level = "低风险（震荡）"
        elif fall_ratio > 0.5:
            risk_level = "中风险（小跌）"
        else:
            risk_level = "高风险（大跌）"

    return {
        # 分类涨跌统计
        "rising": stats["rising"],
        "falling": stats["falling"],
        "flat": stats["flat"],
        # 极值（无数据则为None）
        "max_rise": max_rise,
        "max_fall": max_fall,
        # 风险等级
        "risk_level": risk_level,
        # 平均涨跌幅（用于投资建议）
        "avg_change": avg_change
    }

def get_all_data(incremental=False):
    """获取所有实时数据（核心修复：增量数据仅传递单次值）"""
    current_time = datetime.datetime.now().strftime("%H:%M:%S")
    indices_data = []
    funds_data = []
    errors = []
    
    # 重置增量数据（每次请求都清空，只存本次最新值）
    monitor_cache["incremental_data"] = {"indices": {}, "funds": {}}
    
    # 获取指数数据
    for index_name, code in monitor_cache["index_map"].items():
        index_detail = get_index_detail(code, index_name)
        if index_detail:
            indices_data.append(index_detail)
            # 增量数据仅存本次最新涨跌幅（单次值）
            monitor_cache["incremental_data"]["indices"][index_name] = index_detail["change"]
        else:
            errors.append(f"指数{index_name}数据获取失败")
    
    # 获取基金数据
    for fund_code in monitor_cache["fund_codes"]:
        fund_detail = get_fund_detail(fund_code)
        if fund_detail:
            funds_data.append(fund_detail)
            # 增量数据仅存本次最新涨跌幅（单次值）
            monitor_cache["incremental_data"]["funds"][fund_code] = float(fund_detail["change"])
        else:
            errors.append(f"基金{fund_code}数据获取失败")
    
    # 计算指标
    metrics = calculate_metrics(indices_data, funds_data)
    
    # 页面内实时历史（仅用于首次渲染的初始数据，增量更新由前端维护）
    if not incremental:
        # 首次加载：初始化空历史（避免后端传递旧数据）
        monitor_cache["history"] = {
            "time": [], 
            "index_data": defaultdict(list), 
            "fund_data": defaultdict(list)
        }
    else:
        # 增量更新：后端仅记录，前端负责渲染（核心：只追加本次时间和值）
        monitor_cache["history"]["time"].append(current_time)
        for idx in indices_data:
            monitor_cache["history"]["index_data"][idx["name"]].append(idx["change"])
        for fund in funds_data:
            monitor_cache["history"]["fund_data"][fund["code"]].append(float(fund["change"]))
    
    # 构建返回数据（移除冗余的original_time，简化结构）
    result = {
        "time": current_time,
        "indices": indices_data,
        "funds": funds_data,
        "errors": errors,
        "metrics": metrics,
        "history": monitor_cache["history"],
        "incremental_data": monitor_cache["incremental_data"],
        "refresh_interval": monitor_cache["refresh_interval"],
        "last_update_time": monitor_cache["last_update_time"]
    }
    
    monitor_cache["last_update_time"] = current_time
    return result

# ===================== API 路由（仅保留实时监控相关） =====================
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/monitor')
def monitor():
    return render_template('monitor.html')

# 配置相关接口
@app.route('/api/get_config')
def get_config():
    index_text = '\n'.join([f"{name}|{code}" for name, code in monitor_cache["index_map"].items()])
    fund_text = ' '.join(monitor_cache["fund_codes"])
    return jsonify({
        "success": True,
        "config": {
            "indices": index_text,
            "funds": fund_text,
            "refresh_interval": monitor_cache["refresh_interval"]
        }
    })

@app.route('/api/save_config', methods=['POST'])
def save_config():
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "message": "配置数据为空"})
        
        # 更新指数配置
        index_map = {}
        index_lines = data.get('indices', '').split('\n')
        for line in index_lines:
            line = line.strip()
            if line and '|' in line:
                name, code = line.split('|', 1)
                name = name.strip()
                code = code.strip()
                if name and code:
                    index_map[name] = code
        
        # 更新基金配置
        fund_codes = [code.strip() for code in data.get('funds', '').split(' ') if code.strip()]
        
        # 更新刷新间隔
        try:
            refresh_interval = int(data.get('refresh_interval', 30))
            refresh_interval = max(10, min(300, refresh_interval))
        except:
            refresh_interval = 30
        
        # 更新缓存
        monitor_cache["index_map"] = index_map
        monitor_cache["fund_codes"] = fund_codes
        monitor_cache["refresh_interval"] = refresh_interval
        
        # 清空缓存
        monitor_cache["fund_detail_cache"] = {}
        monitor_cache["index_detail_cache"] = {}
        
        return jsonify({"success": True, "message": "配置保存成功！"})
    except Exception as e:
        print(f"保存配置出错：{str(e)}")
        return jsonify({"success": False, "message": f"配置保存失败：{str(e)}"}), 500

# 实时监控接口
@app.route('/api/get_data')
def get_data():
    incremental = request.args.get('incremental', 'false').lower() == 'true'
    data = get_all_data(incremental)
    return jsonify({"success": True, "data": data})

# 投资建议接口（适配实时监控）
@app.route('/api/get_invest_advice')
def get_invest_advice():
    indices = []
    for name, code in monitor_cache["index_map"].items():
        idx = get_index_detail(code, name)
        if idx:
            indices.append(idx)
    
    funds = []
    for code in monitor_cache["fund_codes"]:
        fund = get_fund_detail(code)
        if fund:
            funds.append(fund)
    
    metrics = calculate_metrics(indices, funds)
    avg_change = metrics["avg_change"]
    
    # 生成建议
    if avg_change > 1:
        summary = "当前市场整体上涨，多数标的表现良好，建议谨慎持有，避免追高。"
        strategies = [
            "对于涨幅较高的标的，可考虑部分止盈",
            "关注成交量变化，警惕冲高回落风险",
            "保持仓位控制，不盲目加仓"
        ]
    elif avg_change > 0:
        summary = "当前市场小幅上涨，整体走势平稳，建议继续持有观察。"
        strategies = [
            "持有核心标的，等待进一步趋势确认",
            "逢低可小幅加仓优质标的",
            "分散投资，降低单一标的风险"
        ]
    elif avg_change > -1:
        summary = "当前市场震荡整理，涨跌互现，建议观望为主。"
        strategies = [
            "减少操作频率，避免频繁交易",
            "关注基本面变化，选择优质标的",
            "预留现金，等待市场方向明确"
        ]
    elif avg_change > -2:
        summary = "当前市场小幅下跌，部分标的调整，建议耐心等待。"
        strategies = [
            "避免恐慌性卖出，关注长期价值",
            "分批加仓被错杀的优质标的",
            "控制仓位，不盲目抄底"
        ]
    else:
        summary = "当前市场大幅下跌，风险较高，建议严控仓位。"
        strategies = [
            "大幅降低仓位，保住本金安全",
            "停止加仓操作，等待市场企稳",
            "关注政策面消息，寻找企稳信号"
        ]
    
    advice = {
        "summary": summary,
        "strategies": strategies,
        "risk_warning": "投资有风险，决策需谨慎。以上建议仅供参考，不构成投资指导。"
    }
    
    return jsonify({"success": True, "advice": advice})

# 错误处理
@app.errorhandler(404)
def page_not_found(e):
    return jsonify({"success": False, "message": "接口不存在"}), 404

@app.errorhandler(500)
def internal_server_error(e):
    return jsonify({"success": False, "message": "服务器内部错误"}), 500

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=8080)


