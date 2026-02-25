// 全局变量
let refreshIntervalId = null;
let charts = {};
let firstLoad = true;

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
    // 首次加载完整数据
    loadData(false);
    loadInvestAdvice();
    
    // 检查配置
    fetch('/api/get_config')
        .then(response => {
            if (!response.ok) throw new Error('获取配置失败');
            return response.json();
        })
        .then(data => {
            if (!data.success || (!data.config.indices && !data.config.funds)) {
                document.getElementById('status-info').innerHTML = `
                    <div style="color: var(--warning);">
                        ⚠️ 尚未配置监控标的，请先前往<a href="/" style="color: var(--primary);">配置中心</a>设置指数和基金代码
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('检查配置失败：', error);
        });
});

// 加载数据 - 支持增量更新
function loadData(incremental = true) {
    fetch(`/api/get_data?incremental=${incremental}`)
        .then(response => {
            if (!response.ok) throw new Error(`数据接口返回错误：${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.success) {
                // 首次加载渲染完整图表，后续只增量更新
                if (firstLoad) {
                    updateOverview(data.data);
                    renderCharts(data.data, false);
                    firstLoad = false;
                } else {
                    updateOverview(data.data);
                    renderCharts(data.data, true);
                }
                
                updateStatusInfo(data.data);
                
                // 清除旧的定时器
                if (refreshIntervalId) {
                    clearInterval(refreshIntervalId);
                }
                
                // 设置新的定时器 - 下次请求使用增量更新
                const interval = data.data.refresh_interval * 1000;
                refreshIntervalId = setInterval(() => {
                    loadData(true);
                    loadInvestAdvice();
                }, interval);
                
                // 显示错误信息
                if (data.data.errors && data.data.errors.length > 0) {
                    showMessage('error', '数据获取异常：<br/>' + data.data.errors.join('<br/>'));
                }
            } else {
                showMessage('error', data.message || '数据加载失败');
            }
        })
        .catch(error => {
            showMessage('error', '数据加载失败：' + error.message);
            // 失败后重试
            setTimeout(() => loadData(incremental), 5000);
        });
}

// 加载投资建议
function loadInvestAdvice() {
    fetch('/api/get_invest_advice')
        .then(response => {
            if (!response.ok) throw new Error(`获取建议失败: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.success && data.advice) {
                renderInvestAdvice(data.advice);
            } else {
                renderInvestAdvice(null);
            }
        })
        .catch(error => {
            console.error('加载投资建议失败：', error);
            renderInvestAdvice(null);
        });
}

// 渲染投资建议
function renderInvestAdvice(advice) {
    const adviceContainer = document.getElementById('advice-container');
    if (!adviceContainer) {
        console.error('未找到 advice-container 元素');
        return;
    }

    if (!advice) {
        adviceContainer.innerHTML = `
            <div class="advice-title">📊 智能投资建议</div>
            <div class="advice-summary">暂无足够数据生成投资建议，请等待数据加载完成。</div>
            <div class="risk-warning">⚠️ 风险提示：投资有风险，决策需谨慎。以上建议仅供参考，不构成投资指导。</div>
        `;
        return;
    }

    adviceContainer.innerHTML = `
        <div class="advice-title">📊 智能投资建议</div>
        ${advice.summary ? `<div class="advice-summary">${advice.summary}</div>` : ''}
        ${advice.strategies && advice.strategies.length > 0 ? `
            <div class="advice-strategies">
                ${advice.strategies.map(strategy => `<div class="advice-strategy">${strategy}</div>`).join('')}
            </div>
        ` : ''}
        <div class="risk-warning">⚠️ 风险提示：${advice.risk_warning || '投资有风险，决策需谨慎。以上建议仅供参考，不构成投资指导。'}</div>
    `;
}

// 更新数据概览（核心修改：分类统计、移除平均涨跌幅、修复极值展示）
function updateOverview(data) {
    const metrics = data.metrics || {};
    const overviewContainer = document.getElementById('overview-container');
    
    overviewContainer.innerHTML = '';
    
    // 处理空数据默认值
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
    
    // 构建概览项（移除平均涨跌幅，新增分类统计）
    const overviewItems = [
        {
            label: '上涨标的',
            value: stats.rising.total,
            desc: `指数${stats.rising.indices} | 基金${stats.rising.funds}`,
            type: 'rising'
        },
        {
            label: '下跌标的',
            value: stats.falling.total,
            desc: `指数${stats.falling.indices} | 基金${stats.falling.funds}`,
            type: 'falling'
        },
        {
            label: '平盘标的',
            value: stats.flat.total,
            desc: `指数${stats.flat.indices} | 基金${stats.flat.funds}`,
            type: 'default'
        },
        {
            label: '最大涨幅',
            value: stats.max_rise.value !== null ? `${stats.max_rise.value.toFixed(2)}%` : '无',
            desc: stats.max_rise.name || '',
            type: 'rising',
            show: stats.max_rise.value !== null
        },
        {
            label: '最大跌幅',
            value: stats.max_fall.value !== null ? `${stats.max_fall.value.toFixed(2)}%` : '无',
            desc: stats.max_fall.name || '',
            type: 'falling',
            show: stats.max_fall.value !== null
        },
        {
            label: '市场风险等级',
            value: stats.risk_level,
            type: 'warning'
        }
    ];
    
    // 渲染概览项（只显示有数据的极值）
    overviewItems.forEach(item => {
        if (item.show === false) return;
        
        const itemElement = document.createElement('div');
        itemElement.className = `overview-item ${item.type}`;
        
        itemElement.innerHTML = `
            <div class="overview-label">${item.label}</div>
            <div class="overview-value">${item.value}</div>
            ${item.desc ? `<div class="overview-desc">${item.desc}</div>` : ''}
        `;
        
        overviewContainer.appendChild(itemElement);
    });
}

// 渲染图表 - 支持增量更新
function renderCharts(data, incremental) {
    const chartsContainer = document.getElementById('charts-container');
    
    // 首次加载：创建图表
    if (!incremental) {
        chartsContainer.innerHTML = '';
        
        // 销毁旧图表
        for (let key in charts) {
            if (charts[key] && charts[key].instance) {
                charts[key].instance.dispose();
            }
        }
        charts = {};
        
        const allChartsData = [];
        const history = data.history || {time: [], index_data: {}, fund_data: {}};
        
        // 添加指数数据
        data.indices.forEach(index => {
            const chartHistory = history.index_data[index.name] || [];
            const times = history.time || [];
            allChartsData.push({
                id: `index_${index.name}`,
                title: index.name,
                // 关键修改：添加符号和含义
                subTitle: `${index.current_price} (${index.change_amount > 0 ? '+' : ''}${index.change_amount}点)`,
                value: index.change,
                xData: times,
                yData: chartHistory,
                type: 'index'
            });
        });
        
        // 添加基金数据
        data.funds.forEach(fund => {
            const chartHistory = history.fund_data[fund.code] || [];
            const times = history.time || [];
            // 计算涨跌额
            const net_value = parseFloat(fund.net_value || 0);
            const estimate_value = parseFloat(fund.estimate_value || 0);
            const change_amount = estimate_value - net_value;
            
            allChartsData.push({
                id: `fund_${fund.code}`,
                title: fund.name || fund.code,
                // 关键修改：添加符号和含义
                subTitle: `${fund.code} | 估值: ${fund.estimate_value || '0.0000'} (${change_amount > 0 ? '+' : ''}${change_amount.toFixed(4)}元)`,
                value: parseFloat(fund.change || 0),
                xData: times,
                yData: chartHistory,
                type: 'fund'
            });
        });
        
        // 无数据提示
        if (allChartsData.length === 0) {
            chartsContainer.innerHTML = `
                <div style="text-align:center; padding: 50px 0; color: var(--text-tertiary);">
                    暂无监控数据，请先前往配置中心设置指数/基金代码
                </div>
            `;
            return;
        }
        
        // 创建图表
        allChartsData.forEach(item => {
            const card = document.createElement('div');
            card.className = 'chart-card';
            
            const header = document.createElement('div');
            header.className = 'chart-header';
            
            const title = document.createElement('div');
            title.className = 'chart-title';
            title.textContent = item.title;
            
            const value = document.createElement('div');
            // 关键修改：涨跌幅添加正负号
            value.className = `chart-value ${item.value > 0 ? 'rising' : item.value < 0 ? 'falling' : 'flat'}`;
            value.textContent = `${item.value > 0 ? '+' : ''}${item.value}%`;
            
            header.appendChild(title);
            header.appendChild(value);
            
            if (item.subTitle) {
                const subTitle = document.createElement('div');
                subTitle.style.fontSize = '12px';
                subTitle.style.color = 'var(--text-tertiary)';
                subTitle.style.marginBottom = '8px';
                subTitle.textContent = item.subTitle;
                card.appendChild(header);
                card.appendChild(subTitle);
            } else {
                card.appendChild(header);
            }
            
            const container = document.createElement('div');
            container.className = 'chart-container';
            container.id = item.id;
            card.appendChild(container);
            
            chartsContainer.appendChild(card);
            
            // 创建ECharts实例
            const chart = echarts.init(document.getElementById(item.id));
            
            let lineColor = '#86909C';
            let areaColor = 'rgba(134, 144, 156, 0.1)';
            
            if (item.value > 0) {
                lineColor = '#F53F3F';
                areaColor = 'rgba(245, 63, 63, 0.1)';
            } else if (item.value < 0) {
                lineColor = '#00B42A';
                areaColor = 'rgba(0, 180, 42, 0.1)';
            }
            
            const option = {
                backgroundColor: 'transparent',
                tooltip: {
                    trigger: 'axis',
                    formatter: function(params) {
                        return `${params[0].axisValue}<br/>涨跌幅: ${params[0].value}%`;
                    },
                    textStyle: {
                        fontSize: 12
                    },
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    borderColor: 'var(--border-light)',
                    borderWidth: 1,
                    shadowBlur: 4,
                    shadowColor: 'rgba(0, 0, 0, 0.1)'
                },
                grid: {
                    left: '12%',
                    right: '5%',
                    top: '10%',
                    bottom: '15%'
                },
                xAxis: {
                    type: 'category',
                    data: item.xData,
                    axisLine: {
                        lineStyle: {
                            color: 'var(--border-light)'
                        }
                    },
                    axisLabel: {
                        rotate: 30,
                        fontSize: 11,
                        color: 'var(--text-tertiary)'
                    },
                    splitLine: {
                        show: false
                    }
                },
                yAxis: {
                    type: 'value',
                    axisLabel: {
                        formatter: '{value}%',
                        fontSize: 11,
                        color: 'var(--text-tertiary)',
                        margin: 10
                    },
                    axisLine: {
                        lineStyle: {
                            color: 'var(--border-light)'
                        }
                    },
                    splitLine: {
                        lineStyle: {
                            color: 'var(--border-light)',
                            type: 'dashed'
                        }
                    },
                    splitNumber: 5
                },
                series: [{
                    name: '涨跌幅',
                    data: item.yData,
                    type: 'line',
                    smooth: true,
                    lineStyle: {
                        color: lineColor,
                        width: 2
                    },
                    areaStyle: {
                        color: areaColor
                    },
                    itemStyle: {
                        color: lineColor
                    },
                    symbol: 'circle',
                    symbolSize: 6,
                    emphasis: {
                        symbolSize: 8
                    }
                }]
            };
            
            chart.setOption(option);
            charts[item.id] = {
                instance: chart,
                option: option,
                type: item.type
            };
            
            window.addEventListener('resize', function() {
                chart.resize();
            });
        });
    } else {
        // 增量更新：只添加新点
        const newTime = data.time;
        const incrementalData = data.incremental_data || {indices: {}, funds: {}};
        
        // 更新指数数据
        for (let index_name in incrementalData.indices) {
            const chartKey = `index_${index_name}`;
            if (charts[chartKey] && charts[chartKey].instance) {
                const chart = charts[chartKey].instance;
                const option = charts[chartKey].option;
                
                // 添加新数据点
                option.xAxis.data.push(newTime);
                option.series[0].data.push(incrementalData.indices[index_name]);
                
                // 更新图表
                chart.setOption({
                    xAxis: {
                        data: option.xAxis.data
                    },
                    series: [{
                        data: option.series[0].data
                    }]
                });
                
                // 更新标题中的最新值
                const valueElement = document.querySelector(`#${chartKey}`).parentNode.querySelector('.chart-value');
                if (valueElement) {
                    valueElement.textContent = `${incrementalData.indices[index_name]}%`;
                    valueElement.className = `chart-value ${incrementalData.indices[index_name] > 0 ? 'rising' : incrementalData.indices[index_name] < 0 ? 'falling' : 'flat'}`;
                }
            }
        }
        
        // 更新基金数据
        for (let fund_code in incrementalData.funds) {
            const chartKey = `fund_${fund_code}`;
            if (charts[chartKey] && charts[chartKey].instance) {
                const chart = charts[chartKey].instance;
                const option = charts[chartKey].option;
                
                // 添加新数据点
                option.xAxis.data.push(newTime);
                option.series[0].data.push(incrementalData.funds[fund_code]);
                
                // 更新图表
                chart.setOption({
                    xAxis: {
                        data: option.xAxis.data
                    },
                    series: [{
                        data: option.series[0].data
                    }]
                });
                
                // 更新标题中的最新值
                const valueElement = document.querySelector(`#${chartKey}`).parentNode.querySelector('.chart-value');
                if (valueElement) {
                    valueElement.textContent = `${incrementalData.funds[fund_code]}%`;
                    valueElement.className = `chart-value ${incrementalData.funds[fund_code] > 0 ? 'rising' : incrementalData.funds[fund_code] < 0 ? 'falling' : 'flat'}`;
                }
            }
        }
    }
}

// 渲染投资建议
function renderInvestAdvice(advice) {
    const adviceContainer = document.getElementById('advice-container');
    if (!advice) {
        adviceContainer.innerHTML = `
            <div class="advice-title">📊 智能投资建议</div>
            <div class="advice-summary">暂无足够数据生成投资建议，请等待数据加载完成。</div>
            <div class="risk-warning">⚠️ 风险提示：投资有风险，决策需谨慎。以上建议仅供参考，不构成投资指导。</div>
        `;
        return;
    }
    
    adviceContainer.innerHTML = `
        <div class="advice-title">📊 智能投资建议</div>
        ${advice.summary ? `<div class="advice-summary">${advice.summary}</div>` : ''}
        ${advice.strategies && advice.strategies.length > 0 ? `
            <div class="advice-strategies">
                ${advice.strategies.map(strategy => `<div class="advice-strategy">${strategy}</div>`).join('')}
            </div>
        ` : ''}
        ${advice.risk_warning ? `<div class="risk-warning">⚠️ 风险提示：${advice.risk_warning}</div>` : ''}
    `;
}

// 更新状态信息
function updateStatusInfo(data) {
    const statusElement = document.getElementById('status-info');
    const now = new Date().toLocaleString();
    const history = data.history || {time: []};
    const refreshInterval = data.refresh_interval || 30;
    
    statusElement.innerHTML = `
        <div>最后更新时间：${now}</div>
        <div>监控状态：🟢 正常运行</div>
        <div>自动刷新间隔：${refreshInterval} 秒</div>
        <div>累计数据点：${history.time ? history.time.length : 0} 个</div>
        <div>监控标的：指数 ${data.indices.length} 个 | 基金 ${data.funds.length} 个</div>
    `;
}

// 显示消息提示
function showMessage(type, message) {
    // 获取消息容器
    let messageContainer = document.getElementById('message-container');
    
    messageContainer.innerHTML = `
        <div class="message-box ${type}">
            ${message}
        </div>
    `;
    
    setTimeout(() => {
        messageContainer.innerHTML = '';
    }, 5000);
}