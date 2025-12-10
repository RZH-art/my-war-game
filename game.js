// ==================== 联机核心模块 ====================
class OnlineManager {
    constructor(game) {
        this.game = game;
        this.socket = null;
        this.peerConnection = null;
        this.roomId = null;
        this.isHost = false;
        this.dataChannel = null; // 用于直接传输游戏数据
        
        this.init();
    }
    
    init() {
        // 绑定按钮事件
        document.getElementById('create-room-btn').addEventListener('click', () => this.createRoom());
        document.getElementById('join-room-btn').addEventListener('click', () => this.joinRoom());
        document.getElementById('close-online-btn').addEventListener('click', () => this.hideModal());
        
        // 在游戏界面添加一个触发联机面板的按钮（你可以放在自己喜欢的位置）
        const onlineBtn = document.createElement('button');
        onlineBtn.innerHTML = '<i class="fas fa-plug"></i> 联机对战';
        onlineBtn.className = 'action-btn';
        onlineBtn.style.position = 'absolute';
        onlineBtn.style.top = '10px';
        onlineBtn.style.right = '10px';
        onlineBtn.style.zIndex = '1000';
        onlineBtn.onclick = () => this.showModal();
        document.querySelector('.game-container').appendChild(onlineBtn);
    }
    
    showModal() {
        document.getElementById('online-modal').classList.add('active');
    }
    
    hideModal() {
        document.getElementById('online-modal').classList.remove('active');
    }
    
    // 连接到信令服务器
    connectToSignalingServer() {
        // 使用一个免费的公共测试服务器（注意：不稳定，仅用于测试）
        // 实际使用时需要部署自己的，见下文部署步骤
        this.socket = io('https://simple-signal-server.onrender.com');
        
        this.socket.on('connect', () => {
            this.log('已连接到信令服务器');
        });
        
        this.socket.on('room_update', (data) => {
            this.log(`房间人数: ${data.count}/2`);
            document.getElementById('connection-status-text').textContent = 
                `已连接，房间内 ${data.count} 人`;
        });
        
        this.socket.on('start_webrtc', (data) => {
            this.log('对方已就绪，开始建立P2P连接...');
            this.createPeerConnection(true, data.target);
        });
        
        this.socket.on('webrtc_signal', (data) => {
            if (this.peerConnection) {
                this.handleSignal(data);
            }
        });
        
        this.socket.on('game_data', (data) => {
            // 收到对手的游戏操作，更新本地游戏状态
            this.handleGameData(data);
        });
        
        this.socket.on('player_left', () => {
            this.log('对手已离开房间');
            if (this.dataChannel) this.dataChannel.close();
            if (this.peerConnection) this.peerConnection.close();
            this.peerConnection = null;
        });
    }
    
    // 创建房间（主机）
    createRoom() {
        const baseRoomId = document.getElementById('room-id-input').value || 'room_' + Math.floor(Math.random() * 1000);
        this.roomId = baseRoomId + '_' + Date.now();
        this.isHost = true;
        
        // 生成可分享的链接
        const shareLink = `${window.location.origin}${window.location.pathname}?join=${this.roomId}`;
        document.getElementById('join-room-input').value = shareLink;
        
        this.log(`房间创建成功！房间号: ${this.roomId}`);
        this.log(`请将上方链接复制分享给朋友`);
        
        this.connectToSignalingServer();
        setTimeout(() => {
            this.socket.emit('join_room', this.roomId);
        }, 500);
    }
    
    // 加入房间（客机）
    joinRoom() {
        const joinInput = document.getElementById('join-room-input').value;
        let roomIdToJoin;
        
        // 从完整链接中提取房间号
        if (joinInput.includes('?join=')) {
            roomIdToJoin = joinInput.split('?join=')[1];
        } else {
            roomIdToJoin = joinInput;
        }
        
        if (!roomIdToJoin) {
            this.log('错误：请输入有效的房间链接或房间号');
            return;
        }
        
        this.roomId = roomIdToJoin;
        this.isHost = false;
        
        this.log(`正在加入房间: ${this.roomId}...`);
        this.connectToSignalingServer();
        setTimeout(() => {
            this.socket.emit('join_room', this.roomId);
        }, 500);
    }
    
    // 创建WebRTC对等连接
    createPeerConnection(isInitiator, targetId) {
        this.log('创建P2P连接...');
        
        // 使用Google的公共STUN服务器
        const config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.peerConnection = new RTCPeerConnection(config);
        
        // 设置数据通道（用于传输游戏指令）
        this.dataChannel = this.peerConnection.createDataChannel('gameData');
        this.setupDataChannel();
        
        // 处理ICE候选信息（网络地址信息）
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.socket) {
                this.socket.emit('webrtc_signal', {
                    target: targetId,
                    signal: { type: 'candidate', candidate: event.candidate }
                });
            }
        };
        
        // 接收远程媒体或数据通道
        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.setupDataChannel();
        };
        
        // 如果是发起方，创建offer
        if (isInitiator) {
            this.peerConnection.createOffer()
                .then(offer => this.peerConnection.setLocalDescription(offer))
                .then(() => {
                    this.socket.emit('webrtc_signal', {
                        target: targetId,
                        signal: this.peerConnection.localDescription
                    });
                });
        }
    }
    
    // 设置数据通道
    setupDataChannel() {
        if (!this.dataChannel) return;
        
        this.dataChannel.onopen = () => {
            this.log('✅ P2P数据通道已建立！可以开始游戏了！');
            document.getElementById('connection-status-text').textContent = '已连接，可以开始游戏';
            this.game.showStatusMessage('已连接到对手，游戏开始！');
            this.hideModal();
        };
        
        this.dataChannel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleGameData(data);
            } catch(e) {
                console.log('收到数据:', event.data);
            }
        };
    }
    
    // 处理WebRTC信令
    async handleSignal(data) {
        try {
            const signal = data.signal;
            
            if (signal.type === 'offer') {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await this.peerConnection.createAnswer();
                await this.peerConnection.setLocalDescription(answer);
                
                this.socket.emit('webrtc_signal', {
                    target: data.from,
                    signal: this.peerConnection.localDescription
                });
            } 
            else if (signal.type === 'answer') {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
            }
            else if (signal.type === 'candidate') {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } catch(error) {
            console.error('处理信令时出错:', error);
        }
    }
    
    // 发送游戏数据给对手
    sendGameData(action, payload) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            const data = { action, payload, timestamp: Date.now() };
            this.dataChannel.send(JSON.stringify(data));
            return true;
        }
        // 如果P2P通道未就绪，通过信令服务器转发
        else if (this.socket && this.roomId) {
            this.socket.emit('game_data', {
                room: this.roomId,
                action,
                payload
            });
            return true;
        }
        return false;
    }
    
    // 处理收到的游戏数据
    handleGameData(data) {
        // 根据游戏动作更新状态
        switch(data.action) {
            case 'END_TURN':
                if (this.game.currentPlayer !== data.payload.player) {
                    this.game.endTurn();
                }
                break;
            case 'MOVE_TROOPS':
                // 这里需要你根据之前的游戏逻辑来实现
                // 例如：this.game.processOpponentMove(data.payload);
                this.game.addMessage(`对手: 从${data.payload.from}调兵到${data.payload.to}`);
                break;
            case 'CHAT_MESSAGE':
                this.game.addMessage(`对手: ${data.payload.text}`);
                break;
        }
    }
    
    log(message) {
        const logDiv = document.getElementById('online-message-log');
        const entry = document.createElement('div');
        entry.textContent = `[${new Date().toLocaleTimeString().slice(0,8)}] ${message}`;
        logDiv.appendChild(entry);
        logDiv.scrollTop = logDiv.scrollHeight;
        console.log(`[联机] ${message}`);
    }
}
// 游戏主逻辑
class Game {
    constructor() {
        this.playerId = null;
        this.roomId = null;
        this.players = {};
        this.currentPlayer = null;
        this.turn = 1;
        this.selectedCity = null;
        this.moveFromCity = null;
        this.mapData = null;
        this.mapZoom = 1;
        this.mapOffset = { x: 0, y: 0 };
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        
        // 初始化游戏数据
        this.cities = {};
        this.troops = {};
        this.technologies = {};
        this.messages = [];
        this.onlineManager = new OnlineManager(this);
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.showConnectionModal();
        this.generateMap();
    }
    
    showConnectionModal() {
        document.getElementById('connection-modal').classList.add('active');
    }
    
    hideConnectionModal() {
        document.getElementById('connection-modal').classList.remove('active');
    }
    
    bindEvents() {
        // 连接按钮
        document.getElementById('connect-btn').addEventListener('click', () => this.connectToGame());
        
        // 标签页切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });
        
        // 结束回合
        document.getElementById('end-turn-btn').addEventListener('click', () => this.endTurn());
        
        // 地图缩放
        document.getElementById('zoom-in').addEventListener('click', () => this.zoomMap(0.2));
        document.getElementById('zoom-out').addEventListener('click', () => this.zoomMap(-0.2));
        document.getElementById('center-map').addEventListener('click', () => this.centerMap());
        
        // 地图交互
        const map = document.getElementById('game-map');
        map.addEventListener('mousedown', (e) => this.startDrag(e));
        map.addEventListener('mousemove', (e) => this.dragMap(e));
        map.addEventListener('mouseup', () => this.endDrag());
        map.addEventListener('wheel', (e) => this.handleWheel(e));
        
        // 发送消息
        document.getElementById('send-message').addEventListener('click', () => this.sendMessage());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // 移动模态框
        document.getElementById('cancel-move').addEventListener('click', () => this.hideMoveModal());
        document.getElementById('troop-slider').addEventListener('input', (e) => {
            document.getElementById('move-count').textContent = e.target.value;
        });
    }
    
    connectToGame() {
        const playerName = document.getElementById('player-name').value || '玩家';
        const roomId = document.getElementById('room-id').value || 'room1';
        const role = document.querySelector('input[name="role"]:checked').value;
        
        this.playerId = 'player_' + Date.now();
        this.roomId = roomId;
        
        // 设置玩家信息
        const playerNum = role === 'create' ? 1 : 2;
        this.setPlayerInfo(playerNum, playerName);
        
        // 更新UI
        document.getElementById('player1-name').textContent = role === 'create' ? playerName : '等待对手...';
        document.getElementById('player2-name').textContent = role === 'join' ? playerName : '等待对手...';
        
        // 设置当前玩家
        this.currentPlayer = playerNum;
        this.updateTurnIndicator();
        
        // 隐藏连接模态框
        this.hideConnectionModal();
        
        // 更新连接状态
        document.getElementById('connection-status').textContent = '🟢 已连接';
        document.getElementById('connection-status').style.color = '#4CAF50';
        
        // 显示状态消息
        this.showStatusMessage(`欢迎，${playerName}！你是${role === 'create' ? '玩家1（绿色）' : '玩家2（红色）'}`);
        
        // 初始化游戏数据
        this.initGameData(playerNum);
        
        // 模拟连接成功（在实际应用中这里应该是WebSocket连接）
        setTimeout(() => {
            this.showStatusMessage('游戏已开始！现在是你的回合。');
        }, 1000);
    }
    
    setPlayerInfo(playerNum, name) {
        this.players[playerNum] = {
            id: this.playerId,
            name: name,
            resources: {
                food: 1000,
                gold: 500,
                population: 2000
            },
            cities: [],
            technologies: []
        };
    }
    
    initGameData(playerNum) {
        // 初始化城市数据
        const initialCities = [
            { id: 'city1', name: '洛阳', x: 200, y: 150, owner: 1 },
            { id: 'city2', name: '长安', x: 400, y: 200, owner: 1 },
            { id: 'city3', name: '邺城', x: 300, y: 350, owner: 1 },
            { id: 'city4', name: '成都', x: 100, y: 300, owner: 2 },
            { id: 'city5', name: '建业', x: 500, y: 300, owner: 2 },
            { id: 'city6', name: '襄阳', x: 350, y: 450, owner: 2 }
        ];
        
        initialCities.forEach(city => {
            this.cities[city.id] = {
                ...city,
                level: 1,
                troops: 1000,
                maxTroops: 2000,
                production: {
                    food: 100,
                    gold: 50,
                    population: 20
                },
                buildings: []
            };
            
            if (city.owner === playerNum) {
                this.players[playerNum].cities.push(city.id);
            }
        });
        
        // 渲染地图
        this.renderMap();
    }
    
    generateMap() {
        // 创建地形
        const terrainTypes = ['plain', 'mountain', 'river'];
        const map = document.getElementById('game-map');
        
        // 创建一些随机地形
        for (let i = 0; i < 20; i++) {
            const terrain = document.createElement('div');
            terrain.className = `terrain ${terrainTypes[Math.floor(Math.random() * terrainTypes.length)]}`;
            terrain.style.left = Math.random() * 90 + '%';
            terrain.style.top = Math.random() * 90 + '%';
            terrain.style.width = Math.random() * 150 + 50 + 'px';
            terrain.style.height = Math.random() * 150 + 50 + 'px';
            map.appendChild(terrain);
        }
    }
    
    renderMap() {
        const map = document.getElementById('game-map');
        
        // 清空现有城市
        document.querySelectorAll('.city').forEach(city => city.remove());
        
        // 渲染所有城市
        Object.values(this.cities).forEach(city => {
            const cityElement = document.createElement('div');
            cityElement.className = 'city';
            cityElement.id = `city-${city.id}`;
            cityElement.style.left = `${city.x}px`;
            cityElement.style.top = `${city.y}px`;
            cityElement.style.borderColor = city.owner === 1 ? '#4CAF50' : '#F44336';
            cityElement.style.background = city.owner === 1 ? 
                'linear-gradient(135deg, rgba(76, 175, 80, 0.8), rgba(56, 142, 60, 0.8))' :
                'linear-gradient(135deg, rgba(244, 67, 54, 0.8), rgba(198, 40, 40, 0.8))';
            
            cityElement.innerHTML = `
                <i class="fas fa-city" style="font-size: 24px;"></i>
                <div class="city-name">${city.name}</div>
                <div class="city-troops">${city.troops}兵</div>
            `;
            
            cityElement.addEventListener('click', () => this.selectCity(city.id));
            cityElement.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.startMoveTroops(city.id);
            });
            
            map.appendChild(cityElement);
        });
        
        // 更新资源显示
        this.updateResourcesDisplay();
    }
    
    selectCity(cityId) {
        const city = this.cities[cityId];
        this.selectedCity = cityId;
        
        // 更新UI
        document.getElementById('selected-city-name').textContent = city.name;
        
        // 更新城市信息面板
        const cityInfo = document.getElementById('city-info');
        cityInfo.innerHTML = `
            <div class="city-details">
                <p><strong>等级:</strong> ${city.level}</p>
                <p><strong>归属:</strong> ${city.owner === 1 ? '玩家1' : '玩家2'}</p>
                <p><strong>守军:</strong> ${city.troops} / ${city.maxTroops}</p>
                <p><strong>资源产出:</strong></p>
                <ul>
                    <li>粮食: ${city.production.food}/回合</li>
                    <li>资金: ${city.production.gold}/回合</li>
                    <li>人口: ${city.production.population}/回合</li>
                </ul>
            </div>
        `;
        
        // 启用/禁用按钮
        const isMyCity = city.owner === this.currentPlayer;
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.disabled = !isMyCity;
        });
    }
    
    startMoveTroops(cityId) {
        if (!this.selectedCity) return;
        
        const fromCity = this.cities[this.selectedCity];
        const toCity = this.cities[cityId];
        
        if (fromCity.owner !== this.currentPlayer) {
            this.showStatusMessage('只能调动自己的部队！');
            return;
        }
        
        if (fromCity.id === toCity.id) return;
        
        this.moveFromCity = this.selectedCity;
        this.moveToCity = cityId;
        
        // 显示移动模态框
        document.getElementById('move-from').textContent = fromCity.name;
        document.getElementById('move-to').textContent = toCity.name;
        
        const slider = document.getElementById('troop-slider');
        slider.max = fromCity.troops;
        slider.value = Math.min(500, fromCity.troops);
        document.getElementById('max-troops').textContent = fromCity.troops;
        document.getElementById('move-count').textContent = slider.value;
        
        document.getElementById('move-modal').classList.add('active');
        
        // 绑定确认移动事件
        const confirmBtn = document.getElementById('confirm-move');
        confirmBtn.onclick = () => this.confirmMove(parseInt(slider.value));
    }
    
    confirmMove(troopCount) {
        if (troopCount <= 0) {
            this.showStatusMessage('请选择要派遣的部队数量！');
            return;
        }
        
        const fromCity = this.cities[this.moveFromCity];
        const toCity = this.cities[this.moveToCity];
        
        // 检查是否有足够部队
        if (fromCity.troops < troopCount) {
            this.showStatusMessage('部队数量不足！');
            return;
        }
        
        // 更新城市部队数量
        fromCity.troops -= troopCount;
        
        // 如果是己方城市，直接增加部队
        if (toCity.owner === this.currentPlayer) {
            toCity.troops += troopCount;
            if (toCity.troops > toCity.maxTroops) {
                toCity.troops = toCity.maxTroops;
            }
            this.showStatusMessage(`已派遣 ${troopCount} 部队到 ${toCity.name}`);
        } else {
            // 攻击敌方城市
            this.attackCity(this.moveFromCity, this.moveToCity, troopCount);
        }
        
        // 更新地图显示
        this.renderMap();
        
        // 隐藏模态框
        this.hideMoveModal();
    }
    
    attackCity(fromCityId, toCityId, troopCount) {
        const fromCity = this.cities[fromCityId];
        const toCity = this.cities[toCityId];
        
        // 简单战斗计算
        const attackPower = troopCount;
        const defensePower = toCity.troops * (1 + (toCity.level - 1) * 0.2);
        
        let resultMessage = `攻击 ${toCity.name}...`;
        
        if (attackPower > defensePower) {
            // 攻击成功
            const remainingTroops = Math.floor(attackPower - defensePower);
            toCity.owner = this.currentPlayer;
            toCity.troops = remainingTroops;
            
            // 更新玩家城市列表
            const oldOwner = toCity.owner === 1 ? 2 : 1;
            this.players[oldOwner].cities = this.players[oldOwner].cities.filter(id => id !== toCityId);
            this.players[this.currentPlayer].cities.push(toCityId);
            
            resultMessage = `成功占领 ${toCity.name}！剩余 ${remainingTroops} 部队`;
            
            // 检查胜利条件
            this.checkVictory();
        } else {
            // 攻击失败
            const defenderLoss = Math.floor(defensePower * 0.3);
            const attackerLoss = troopCount;
            
            toCity.troops -= defenderLoss;
            if (toCity.troops < 0) toCity.troops = 0;
            
            resultMessage = `攻击失败！损失 ${attackerLoss} 部队，敌军损失 ${defenderLoss} 部队`;
        }
        
        this.showStatusMessage(resultMessage);
        this.addMessage(resultMessage);
    }
    
    hideMoveModal() {
        document.getElementById('move-modal').classList.remove('active');
        this.moveFromCity = null;
        this.moveToCity = null;
    }
    
    endTurn() {
        if (!this.currentPlayer) return;
        
        // 计算回合收入
        this.calculateTurnIncome();
        
        // 切换回合
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
        this.turn++;
        if (this.onlineManager) {
        this.onlineManager.sendGameData('END_TURN', { 
            player: this.currentPlayer, // 注意：这里已经是切换后的玩家，表示对手的回合开始了
            turn: this.turn 
        });
    }
        
        // 更新UI
        this.updateTurnIndicator();
        
        // 显示状态消息
        this.showStatusMessage(`第 ${this.turn} 回合，${this.currentPlayer === 1 ? '玩家1' : '玩家2'}的回合`);
        
        // 更新资源显示
        this.updateResourcesDisplay();
        
        // 添加消息
        this.addMessage(`第 ${this.turn} 回合开始`);
        
        // 清除选择
        this.selectedCity = null;
        document.getElementById('city-info').innerHTML = '<p>点击地图上的城市查看详情</p>';
        document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = true);
    }
    
    calculateTurnIncome() {
        // 为当前玩家计算城市产出
        const player = this.players[this.currentPlayer];
        
        player.cities.forEach(cityId => {
            const city = this.cities[cityId];
            player.resources.food += city.production.food;
            player.resources.gold += city.production.gold;
            player.resources.population += city.production.population;
            
            // 人口自然增长
            city.production.population = Math.floor(city.production.population * 1.05);
        });
    }
    
    updateResourcesDisplay() {
        // 更新玩家1资源
        if (this.players[1]) {
            document.getElementById('p1-food').textContent = this.players[1].resources.food;
            document.getElementById('p1-gold').textContent = this.players[1].resources.gold;
            document.getElementById('p1-pop').textContent = this.players[1].resources.population;
        }
        
        // 更新玩家2资源
        if (this.players[2]) {
            document.getElementById('p2-food').textContent = this.players[2].resources.food;
            document.getElementById('p2-gold').textContent = this.players[2].resources.gold;
            document.getElementById('p2-pop').textContent = this.players[2].resources.population;
        }
    }
    
    updateTurnIndicator() {
        document.getElementById('turn').textContent = this.turn;
        document.getElementById('turn-indicator').style.color = this.currentPlayer === 1 ? '#4CAF50' : '#F44336';
        
        // 高亮当前玩家
        const p1Info = document.getElementById('player1-info');
        const p2Info = document.getElementById('player2-info');
        
        p1Info.style.border = this.currentPlayer === 1 ? '2px solid #4CAF50' : 'none';
        p2Info.style.border = this.currentPlayer === 2 ? '2px solid #F44336' : 'none';
    }
    
    switchTab(tabName) {
        // 移除所有active类
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.panel-content').forEach(content => content.classList.remove('active'));
        
        // 激活选中的标签和内容
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-panel`).classList.add('active');
    }
    
    startDrag(e) {
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
        document.getElementById('game-map').style.cursor = 'grabbing';
    }
    
    dragMap(e) {
        if (!this.isDragging) return;
        
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;
        
        this.mapOffset.x += dx;
        this.mapOffset.y += dy;
        
        const map = document.getElementById('game-map');
        map.style.transform = `translate(${this.mapOffset.x}px, ${this.mapOffset.y}px) scale(${this.mapZoom})`;
        
        this.dragStart = { x: e.clientX, y: e.clientY };
    }
    
    endDrag() {
        this.isDragging = false;
        document.getElementById('game-map').style.cursor = 'grab';
    }
    
    handleWheel(e) {
        e.preventDefault();
        const zoomChange = e.deltaY > 0 ? -0.1 : 0.1;
        this.zoomMap(zoomChange);
    }
    
    zoomMap(zoomChange) {
        this.mapZoom += zoomChange;
        this.mapZoom = Math.max(0.5, Math.min(2, this.mapZoom));
        
        const map = document.getElementById('game-map');
        map.style.transform = `translate(${this.mapOffset.x}px, ${this.mapOffset.y}px) scale(${this.mapZoom})`;
    }
    
    centerMap() {
        this.mapOffset = { x: 0, y: 0 };
        this.mapZoom = 1;
        
        const map = document.getElementById('game-map');
        map.style.transform = `translate(0px, 0px) scale(1)`;
    }
    
    sendMessage() {
        const input = document.getElementById('message-input');
        const message = input.value.trim();
        
        if (message) {
            this.addMessage(`${this.players[this.currentPlayer].name}: ${message}`);
            input.value = '';
        }
    }
    
    addMessage(message) {
        const messagesDiv = document.getElementById('message-log');
        const messageElement = document.createElement('div');
        messageElement.textContent = `[${this.getTime()}] ${message}`;
        messageElement.style.padding = '5px 0';
        messageElement.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
        
        messagesDiv.appendChild(messageElement);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        this.messages.push(message);
    }
    
    showStatusMessage(message) {
        const statusDiv = document.getElementById('status-message');
        statusDiv.textContent = message;
        
        // 3秒后清除消息
        setTimeout(() => {
            if (statusDiv.textContent === message) {
                statusDiv.textContent = '准备就绪';
            }
        }, 3000);
    }
    
    checkVictory() {
        const player1Cities = Object.values(this.cities).filter(city => city.owner === 1).length;
        const player2Cities = Object.values(this.cities).filter(city => city.owner === 2).length;
        const totalCities = Object.keys(this.cities).length;
        
        if (player1Cities >= totalCities * 0.8) {
            this.showVictory(1);
        } else if (player2Cities >= totalCities * 0.8) {
            this.showVictory(2);
        }
    }
    
    showVictory(playerNum) {
        const winnerName = playerNum === 1 ? '玩家1' : '玩家2';
        alert(`🎉 游戏结束！${winnerName}获得胜利！\n占领了80%的城市！`);
        
        // 禁用游戏操作
        document.getElementById('end-turn-btn').disabled = true;
        document.querySelectorAll('.action-btn').forEach(btn => btn.disabled = true);
    }
    
    getTime() {
        const now = new Date();
        return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
}

// 初始化游戏
const game = new Game();