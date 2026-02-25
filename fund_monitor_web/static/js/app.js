// 首页配置管理脚本
document.addEventListener('DOMContentLoaded', function() {
    // 初始化配置加载
    initConfig();
    
    // 绑定表单提交事件
    bindFormSubmit();
    
    // 绑定导航按钮事件
    bindNavigationEvents();
});

/**
 * 初始化加载配置
 */
function initConfig() {
    // 显示加载状态
    showMessage('info', '正在加载当前配置...');
    
    fetch('/api/get_config')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP错误，状态码：${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // 填充配置表单
                document.getElementById('indices').value = data.config.indices || '';
                document.getElementById('funds').value = data.config.funds || '';
                document.getElementById('refresh_interval').value = data.config.refresh_interval || 30;
                
                showMessage('success', '配置加载成功！');
            } else {
                showMessage('error', `配置加载失败：${data.message}`);
            }
        })
        .catch(error => {
            showMessage('error', `配置加载异常：${error.message}`);
        });
}

/**
 * 绑定表单提交事件
 */
function bindFormSubmit() {
    const configForm = document.getElementById('config-form');
    
    configForm.addEventListener('submit', function(e) {
        e.preventDefault();
        
        // 获取表单数据
        const configData = {
            indices: document.getElementById('indices').value.trim(),
            funds: document.getElementById('funds').value.trim(),
            refresh_interval: parseInt(document.getElementById('refresh_interval').value) || 30
        };
        
        // 验证数据
        if (!configData.indices && !configData.funds) {
            showMessage('warning', '请至少配置指数或基金其中一项！');
            return;
        }
        
        if (configData.refresh_interval < 10 || configData.refresh_interval > 300) {
            showMessage('warning', '刷新间隔必须在10-300秒之间！');
            return;
        }
        
        // 提交配置
        submitConfig(configData);
    });
}

/**
 * 提交配置到后端
 * @param {Object} configData 配置数据
 */
function submitConfig(configData) {
    showMessage('info', '正在保存配置，请稍候...');
    
    fetch('/api/set_config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify(configData)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP错误，状态码：${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            showMessage('success', '配置保存成功！');
            
            // 2秒后自动跳转到监控页面（可选）
            setTimeout(() => {
                window.location.href = '/monitor';
            }, 2000);
        } else {
            showMessage('error', `配置保存失败：${data.message}`);
        }
    })
    .catch(error => {
        showMessage('error', `配置提交异常：${error.message}`);
    });
}

/**
 * 绑定导航按钮事件
 */
function bindNavigationEvents() {
    // 前往监控页面
    document.getElementById('goto-monitor').addEventListener('click', function() {
        window.location.href = '/monitor';
    });
    
    // 前往历史分析页面
    const gotoHistoryBtn = document.getElementById('goto-history');
    if (gotoHistoryBtn) {
        gotoHistoryBtn.addEventListener('click', function() {
            window.location.href = '/history';
        });
    }
    
    // 重置配置按钮
    const resetConfigBtn = document.getElementById('reset-config');
    if (resetConfigBtn) {
        resetConfigBtn.addEventListener('click', function() {
            if (confirm('确定要重置为默认配置吗？')) {
                // 默认配置
                const defaultConfig = {
                    indices: `上证指数|sh000001
深证成指|sz399001
创业板指|sz399006`,
                    funds: '015790 002112 009854',
                    refresh_interval: 30
                };
                
                // 填充表单
                document.getElementById('indices').value = defaultConfig.indices;
                document.getElementById('funds').value = defaultConfig.funds;
                document.getElementById('refresh_interval').value = defaultConfig.refresh_interval;
                
                showMessage('info', '已重置为默认配置，请点击保存生效！');
            }
        });
    }
}

/**
 * 显示消息提示
 * @param {String} type 消息类型：success/error/warning/info
 * @param {String} message 消息内容
 */
function showMessage(type, message) {
    const messageContainer = document.getElementById('message-container');
    
    // 构建样式类
    let className = 'message-box ';
    switch(type) {
        case 'success':
            className += 'success';
            break;
        case 'error':
            className += 'error';
            break;
        case 'warning':
            className += 'warning';
            break;
        default:
            className += 'info';
    }
    
    // 创建消息元素
    messageContainer.innerHTML = `
        <div class="${className}">
            ${message}
        </div>
    `;
    
    // 自动清除提示（除了error类型）
    if (type !== 'error') {
        setTimeout(() => {
            messageContainer.innerHTML = '';
        }, 5000);
    }
}

// 扩展：添加配置格式验证提示
document.getElementById('indices').addEventListener('blur', function() {
    const value = this.value.trim();
    if (value) {
        const lines = value.split('\n');
        let errorLines = [];
        
        lines.forEach((line, index) => {
            line = line.trim();
            if (line && !line.includes('|')) {
                errorLines.push(`第${index+1}行：格式错误，应为"名称|代码"`);
            }
        });
        
        if (errorLines.length > 0) {
            showMessage('warning', `指数配置格式检查：<br/>${errorLines.join('<br/>')}`);
        }
    }
});

// 快捷键支持
document.addEventListener('keydown', function(e) {
    // Ctrl+S 保存配置
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        document.getElementById('config-form').dispatchEvent(new Event('submit'));
    }
    
    // Ctrl+M 前往监控页面
    if (e.ctrlKey && e.key === 'm') {
        e.preventDefault();
        window.location.href = '/monitor';
    }
    
    // Ctrl+H 前往历史页面
    if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        window.location.href = '/history';
    }
});