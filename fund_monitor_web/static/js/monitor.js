// 全局变量
let refreshIntervalId = null;
let charts = {}; // 格式：{chartId: {instance: echarts实例, xData: [], yData: []}}
let firstLoad = true;

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    loadData(false);
    loadInvestAdvice();
    
    fetch('/api/get_config')
        .then(response => response.ok ? response.json() : Promise.reject('配置接口失败'))
        .then(data => {
            if (!data.success || (!data.config.indices && !data.config.funds)) {
                document.getElementById('status-info').innerHTML = `
                    <div style="color: #f59e0b;">
                        ⚠️ 未配置监控标的，请前往<a href="/" style="color: #3b82f6;">配置中心</a>设置
                    </div>
                `;
            }
        })
        .catch(error => console.error('检查配置失败：', error));
});

// 加载数据 - 支持增量更新
function loadData(incremental = true) {
    fetch(`/api/get_data?incremental=${incremental}`)
        .then(response => response.ok ? response.json() : Promise.reject(`接口错误：${response.status}`))
        .then(data => {
            if (data.success) {
                firstLoad ? initCharts(data.data) : updateCharts(data.data);
                updateOverview(data.data);
                updateStatusInfo(data.data);
                resetTimer(data.data.refresh_interval * 1000);
                data.data.errors.length > 0 && showMessage('error', data.data.errors.join('<br/>'));
            } else {
                showMessage('error', data.message || '数据加载失败');
            }
        })
        .catch(error => {
            showMessage('error', `数据加载失败：${error.message}`);
            setTimeout(() => loadData(incremental), 5000);
        });
}

// 首次初始化图表（核心：初始化空数据，避免初始刻度异常）
function initCharts(data) {
    const chartsContainer = document.getElementById('charts-container');
    chartsContainer.innerHTML = '';
    charts = {}; // 清空旧图表
    
    const indices = data.indices || [];
    const funds = data.funds || [];
    const initialHistory = data.history || {time: [], index_data: {}, fund_data: {}};

    // 生成图表数据列表
    const chartList = [
        // 指数图表
        ...indices.map(index => ({
            id: `index_${index.name}`,
            title: index.name,
            subTitle: `${index.current_price.toFixed(2)} (${index.change_amount > 0 ? '+' : ''}${index.change_amount.toFixed(2)}点)`,
            initialX: initialHistory.time || [],
            initialY: initialHistory.index_data[index.name] || [],
            value: index.change,
            key: index.name,
            type: 'index'
        })),
        // 基金图表
        ...funds.map(fund => {
            const netVal = parseFloat(fund.net_value || 0);
            const estVal = parseFloat(fund.estimate_value || 0);
            const changeAmount = estVal - netVal;
            return {
                id: `fund_${fund.code}`,
                title: fund.name || fund.code,
                subTitle: `${fund.code} | 估值: ${estVal.toFixed(4)} (${changeAmount > 0 ? '+' : ''}${changeAmount.toFixed(4)}元)`,
                initialX: initialHistory.time || [],
                initialY: initialHistory.fund_data[fund.code] || [],
                value: parseFloat(fund.change || 0),
                key: fund.code,
                type: 'fund'
            };
        })
    ];

    if (chartList.length === 0) {
        chartsContainer.innerHTML = `<div style="text-align:center; padding: 50px 0; color: #64748b;">暂无监控数据，请先配置</div>`;
        return;
    }

    // 创建图表
    chartList.forEach(item => {
        // 创建卡片DOM
        const card = document.createElement('div');
        card.className = 'chart-card';
        card.innerHTML = `
            <div class="chart-header">
                <div class="chart-title">${item.title}</div>
                <div class="chart-value ${item.value > 0 ? 'rising' : item.value < 0 ? 'falling' : 'flat'}">
                    ${item.value > 0 ? '+' : ''}${item.value.toFixed(2)}%
                </div>
            </div>
            <div style="font-size:12px; color:#64748b; margin-bottom:8px;">${item.subTitle}</div>
            <div class="chart-container" id="${item.id}"></div>
        `;
        chartsContainer.appendChild(card);

        // 初始化ECharts
        const chart = echarts.init(document.getElementById(item.id));
        const lineColor = item.value > 0 ? '#ef4444' : item.value < 0 ? '#22c55e' : '#64748b';
        const areaColor = item.value > 0 ? 'rgba(239, 68, 68, 0.1)' : item.value < 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(100, 116, 139, 0.1)';

        const option = {
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'axis',
                formatter: (params) => `${params[0].axisValue}<br/>涨跌幅: ${params[0].value.toFixed(2)}%`,
                textStyle: {fontSize: 12},
                backgroundColor: 'rgba(255,255,255,0.9)',
                borderColor: '#e2e8f0',
                borderWidth: 1
            },
            grid: {left: '10%', right: '5%', top: '10%', bottom: '20%'},
            xAxis: {
                type: 'category',
                data: item.initialX,
                axisLine: {lineStyle: {color: '#e2e8f0'}},
                axisLabel: {rotate: 30, fontSize: 11, color: '#64748b'},
                splitLine: {show: false}
            },
            yAxis: {
                type: 'value',
                axisLabel: {formatter: '{value}%', fontSize: 11, color: '#64748b'},
                axisLine: {lineStyle: {color: '#e2e8f0'}},
                splitLine: {lineStyle: {color: '#e2e8f0', type: 'dashed'}},
                // 初始Y轴范围：基于初始数据自动计算，无数据时用±0.5%
                min: item.initialY.length > 0 ? Math.min(...item.initialY) - 0.1 : -0.5,
                max: item.initialY.length > 0 ? Math.max(...item.initialY) + 0.1 : 0.5
            },
            series: [{
                name: '涨跌幅',
                data: item.initialY,
                type: 'line',
                smooth: false, // 关闭平滑，符合实时监控需求
                lineStyle: {color: lineColor, width: 2},
                areaStyle: {color: areaColor},
                symbol: 'circle',
                symbolSize: 4,
                emphasis: {symbolSize: 6}
            }]
        };

        chart.setOption(option);
        // 存储图表核心数据（xData/yData由前端维护，避免依赖后端）
        charts[item.id] = {
            instance: chart,
            xData: [...item.initialX],
            yData: [...item.initialY],
            key: item.key,
            type: item.type
        };

        // 窗口缩放适配
        window.addEventListener('resize', () => chart.resize());
    });

    firstLoad = false;
}

// 增量更新图表（彻底重写，确保数据更新和Y轴格式正确）
function updateCharts(data) {
    const newTime = data.time;
    const incData = data.incremental_data || {indices: {}, funds: {}};
    const indices = data.indices || [];
    const funds = data.funds || [];

    // 更新指数图表
    indices.forEach(index => {
        const chartId = `index_${index.name}`;
        if (!charts[chartId]) return;

        const chart = charts[chartId].instance;
        // 1. 从最新的 index 对象中获取 change 值，确保是最新的
        const newY = parseFloat(index.change) || 0;
        
        // 2. 严格校验新值，过滤掉任何离谱的数字
        if (isNaN(newY) || Math.abs(newY) > 100) {
            console.warn(`指数${index.name}出现异常值：${newY}%，已过滤`);
            return;
        }

        // 3. 追加数据（前端维护，最可靠）
        charts[chartId].xData.push(newTime);
        charts[chartId].yData.push(newY);
        // 限制数据点数量（最多保留50个，避免图表拥挤）
        if (charts[chartId].xData.length > 50) {
            charts[chartId].xData.shift();
            charts[chartId].yData.shift();
        }

        // 4. 重新计算Y轴范围（核心：基于最新有效数据）
        const yData = charts[chartId].yData;
        const yMin = Math.min(...yData) - 0.05;
        const yMax = Math.max(...yData) + 0.05;

        // 5. 完整更新图表，强制Y轴刻度保留两位小数
        chart.setOption({
            xAxis: {data: charts[chartId].xData},
            yAxis: {
                min: yMin,
                max: yMax,
                // 强制格式化Y轴标签，显示两位小数
                axisLabel: {
                    formatter: function(value) {
                        return value.toFixed(2) + '%';
                    }
                }
            },
            series: [{data: yData}]
        });

        // 6. 更新卡片标题的最新值
        const valueEl = document.querySelector(`#${chartId}`).parentNode.querySelector('.chart-value');
        if (valueEl) {
            valueEl.textContent = `${newY > 0 ? '+' : ''}${newY.toFixed(2)}%`;
            valueEl.className = `chart-value ${newY > 0 ? 'rising' : newY < 0 ? 'falling' : 'flat'}`;
        }

        // 7. 更新子标题（涨跌额）
        const subTitleEl = document.querySelector(`#${chartId}`).parentNode.querySelector('div[style*="font-size:12px"]');
        if (subTitleEl) {
            subTitleEl.textContent = `${index.current_price.toFixed(2)} (${index.change_amount > 0 ? '+' : ''}${index.change_amount.toFixed(2)}点)`;
        }
    });

    // 更新基金图表（逻辑同上）
    funds.forEach(fund => {
        const chartId = `fund_${fund.code}`;
        if (!charts[chartId]) return;

        const chart = charts[chartId].instance;
        // 1. 从最新的 fund 对象中获取 change 值
        const newY = parseFloat(fund.change) || 0;
        
        // 2. 严格校验新值
        if (isNaN(newY) || Math.abs(newY) > 100) {
            console.warn(`基金${fund.code}出现异常值：${newY}%，已过滤`);
            return;
        }

        // 3. 追加数据
        charts[chartId].xData.push(newTime);
        charts[chartId].yData.push(newY);
        if (charts[chartId].xData.length > 50) {
            charts[chartId].xData.shift();
            charts[chartId].yData.shift();
        }

        // 4. 重新计算Y轴范围
        const yData = charts[chartId].yData;
        const yMin = Math.min(...yData) - 0.05;
        const yMax = Math.max(...yData) + 0.05;

        // 5. 完整更新图表，强制Y轴刻度保留两位小数
        chart.setOption({
            xAxis: {data: charts[chartId].xData},
            yAxis: {
                min: yMin,
                max: yMax,
                // 强制格式化Y轴标签，显示两位小数
                axisLabel: {
                    formatter: function(value) {
                        return value.toFixed(2) + '%';
                    }
                }
            },
            series: [{data: yData}]
        });

        // 6. 更新卡片标题的最新值
        const valueEl = document.querySelector(`#${chartId}`).parentNode.querySelector('.chart-value');
        if (valueEl) {
            valueEl.textContent = `${newY > 0 ? '+' : ''}${newY.toFixed(2)}%`;
            valueEl.className = `chart-value ${newY > 0 ? 'rising' : newY < 0 ? 'falling' : 'flat'}`;
        }

        // 7. 更新子标题（估值+涨跌额）
        const netVal = parseFloat(fund.net_value || 0);
        const estVal = parseFloat(fund.estimate_value || 0);
        const changeAmount = estVal - netVal;
        const subTitleEl = document.querySelector(`#${chartId}`).parentNode.querySelector('div[style*="font-size:12px"]');
        if (subTitleEl) {
            subTitleEl.textContent = `${fund.code} | 估值: ${estVal.toFixed(4)} (${changeAmount > 0 ? '+' : ''}${changeAmount.toFixed(4)}元)`;
        }
    });
}

function loadInvestAdvice() {
    fetch('/api/get_invest_advice')
        .then(response => response.ok ? response.json() : Promise.reject('建议接口失败'))
        .then(data => renderInvestAdvice(data.success ? data.advice : null))
        .catch(error => {
            console.error('加载投资建议失败：', error);
            renderInvestAdvice(null);
        });
}

function updateOverview(data) {
    const metrics = data.metrics || {};
    const overviewContainer = document.getElementById('overview-container');
    overviewContainer.innerHTML = '';

    const defaultStats = {
        rising: {indices: 0, funds: 0, total: 0},
        falling: {indices: 0, funds: 0, total: 0},
        flat: {indices: 0, funds: 0, total: 0},
        max_rise: {name: '', value: null},
        max_fall: {name: '', value: null},
        risk_level: '未检测'
    };

    const stats = {
        rising: metrics.rising || defaultStats.rising,
        falling: metrics.falling || defaultStats.falling,
        flat: metrics.flat || defaultStats.flat,
        max_rise: metrics.max_rise || defaultStats.max_rise,
        max_fall: metrics.max_fall || defaultStats.max_fall,
        risk_level: metrics.risk_level || defaultStats.risk_level
    };

    const overviewItems = [
        {label: '上涨标的', value: stats.rising.total, desc: `指数${stats.rising.indices} | 基金${stats.rising.funds}`, type: 'rising'},
        {label: '下跌标的', value: stats.falling.total, desc: `指数${stats.falling.indices} | 基金${stats.falling.funds}`, type: 'falling'},
        {label: '平盘标的', value: stats.flat.total, desc: `指数${stats.flat.indices} | 基金${stats.flat.funds}`, type: 'default'},
        {label: '最大涨幅', value: stats.max_rise.value !== null ? `${stats.max_rise.value.toFixed(2)}%` : '无', desc: stats.max_rise.name || '', type: 'rising', show: stats.max_rise.value !== null},
        {label: '最大跌幅', value: stats.max_fall.value !== null ? `${stats.max_fall.value.toFixed(2)}%` : '无', desc: stats.max_fall.name || '', type: 'falling', show: stats.max_fall.value !== null},
        {label: '市场风险等级', value: stats.risk_level, type: 'warning'}
    ];

    overviewItems.forEach(item => {
        if (item.show === false) return;
        const itemEl = document.createElement('div');
        itemEl.className = `overview-item ${item.type}`;
        itemEl.innerHTML = `
            <div class="overview-label">${item.label}</div>
            <div class="overview-value">${item.value}</div>
            ${item.desc ? `<div class="overview-desc">${item.desc}</div>` : ''}
        `;
        overviewContainer.appendChild(itemEl);
    });
}

function renderInvestAdvice(advice) {
    const container = document.getElementById('advice-container');
    if (!container) return;

    if (!advice) {
        container.innerHTML = `
            <div class="advice-title">📊 智能投资建议</div>
            <div class="advice-summary">暂无足够数据生成建议，请等待数据加载。</div>
            <div class="risk-warning">⚠️ 投资有风险，决策需谨慎。</div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="advice-title">📊 智能投资建议</div>
        ${advice.summary ? `<div class="advice-summary">${advice.summary}</div>` : ''}
        ${advice.strategies?.length ? `<div class="advice-strategies">${advice.strategies.map(s => `<div class="advice-strategy">${s}</div>`).join('')}</div>` : ''}
        <div class="risk-warning">⚠️ 风险提示：${advice.risk_warning || '投资有风险，决策需谨慎。'}</div>
    `;
}

function updateStatusInfo(data) {
    const el = document.getElementById('status-info');
    const now = new Date().toLocaleString();
    const history = data.history || {time: []};
    const interval = data.refresh_interval || 30;
    el.innerHTML = `
        <div>最后更新：${now}</div>
        <div>监控状态：🟢 正常</div>
        <div>刷新间隔：${interval} 秒</div>
        <div>数据点：${history.time.length} 个</div>
        <div>标的：指数 ${data.indices.length} | 基金 ${data.funds.length}</div>
    `;
}

function resetTimer(interval) {
    if (refreshIntervalId) clearInterval(refreshIntervalId);
    refreshIntervalId = setInterval(() => {
        loadData(true);
        loadInvestAdvice();
    }, interval);
}

function showMessage(type, msg) {
    const container = document.getElementById('message-container') || (() => {
        const el = document.createElement('div');
        el.id = 'message-container';
        document.querySelector('.container').appendChild(el);
        return el;
    })();

    container.innerHTML = `<div class="message-box ${type}">${msg}</div>`;
    setTimeout(() => container.innerHTML = '', 5000);
}