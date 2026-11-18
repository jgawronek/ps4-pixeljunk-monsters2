// GameCore/GameCorePlayer.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.GameCorePlayer methods @0x4B91F0, 0x4BDE50, 0x4C1280..0x4C30B0.
//
// Sim-side avatar state. Movement itself is presentation-driven (Q4.Player /
// PlayerMotor write position/facingDegrees into this object); the sim tick here
// derives forward direction, collects pickups, reveals hidden tree pickups,
// processes delayed loose-currency drops (when bumped by enemies) and ticks
// buffs. Fruit carrying is tracked via m_heldFruitHandle.

using System.Linq;
using UnityEngine;

namespace GameCore
{
    public class GameCorePlayer : GameCoreObject, IBuffs, ISpeedScale
    {
        public int playerId;                  // 0x60
        public float facingDegrees;           // 0x64
        public int animationStateHash;        // 0x68
        public float animationStateTime;      // 0x6C
        public int towerDanceHandle = -1;     // 0x70 (pre-base initializer)
        public float sampleTime;              // 0x74
        public float IdleTime { get; protected set; }   // 0x78 (auto-property)
        public float XPTime { get; protected set; }     // 0x7C (auto-property)
        private bool m_isPendingLooseCoins;   // 0x80
        private int m_looseCoinsDelay;        // 0x84
        private int m_lossCoins;              // 0x88
        private int m_dropCoins;              // 0x8C
        private int m_lossGems;               // 0x90
        private int m_dropGems;               // 0x94
        private int m_valuePerCoin;           // 0x98
        private int m_valuePerGem;            // 0x9C
        private BuffContainer m_buffs;        // 0xA0
        private GameCoreHandle m_heldFruitHandle = GameCoreHandle.nullHandle; // 0xA8
        private float m_speedScale = 1.0f;    // 0xC8 (pre-base initializer)
        private Vector3 m_lastPosition;       // 0xCC
        private Vector3 m_forward;            // 0xD8

        // get_Buffs @0x4C1570 (IBuffs, slot 9)
        public BuffContainer Buffs { get { return m_buffs; } }

        // get_IsHoldingFruit @0x4C1580
        public bool IsHoldingFruit { get { return m_heldFruitHandle.m_handle != -1; } }

        // get_forward @0x4C1600
        public Vector3 forward { get { return m_forward; } }

        // get_HeldFruit @0x4C1640
        public GameCoreFruit HeldFruit
        {
            get { return m_heldFruitHandle.GetMostRecentObjectVersion<GameCoreFruit>(); }
        }

        // get_IsHeldFruitError @0x4C1690
        // True when a fruit handle is set but no longer resolves; clears the handle.
        public bool IsHeldFruitError
        {
            get
            {
                if (HeldFruit != null)
                    return false;
                if (m_heldFruitHandle.m_handle == -1)
                    return false;
                m_heldFruitHandle = GameCoreHandle.nullHandle;
                return true;
            }
        }

        // .ctor @0x4C1280
        public GameCorePlayer()
            : base()
        {
            if (GameCore.Instance == null)
                return;   // binary: early-out, no buffs/events wired

            IdleTime = 0.0f;
            XPTime = 0.0f;
            collision = new Cylinder(0.15f, 0.75f);
            m_buffs = new BuffContainer();
            m_lastPosition = position;

            Events.fruitPickedUpEvent.AddListener(OnFruitPickedUp, Event.EventTime.Immediate);
            Events.fruitDroppedEvent.AddListener(OnFruitDropped, Event.EventTime.Immediate);
        }

        // GetSpeedScale @0x4C1620 (ISpeedScale, slot 10)
        public float GetSpeedScale()
        {
            return m_speedScale;
        }

        // SetSpeedScale @0x4C1630 (ISpeedScale, slot 11)
        public void SetSpeedScale(float scale)
        {
            m_speedScale = scale;
        }

        // IsLocalPlayer @0x4B91F0
        public bool IsLocalPlayer()
        {
            if (!Q4.Networking.NetworkMatch.IsNetworkMatch)
                return true;
            if (Q4.Networking.NetworkMatch.Instance == null)
                return true;
            return Q4.Networking.NetworkMatch.Instance.LocalPlayerId == playerId;
        }

        // GetPlayerCount @0x4C1820
        public static int GetPlayerCount()
        {
            var players = GameCore.Instance.AllObjects<GameCorePlayer>();
            if (players == null)
                return 0;
            return players.Count();
        }

        // GetLocalPlayer @0x4C1890
        public static GameCorePlayer GetLocalPlayer()
        {
            foreach (GameCorePlayer player in GameCore.Instance.AllObjects<GameCorePlayer>())
            {
                if (player.IsLocalPlayer())
                    return player;
            }
            return null;
        }

        // GetPlayer @0x4BDE50
        public static GameCorePlayer GetPlayer(int playerId)
        {
            foreach (GameCorePlayer player in GameCore.Instance.AllObjects<GameCorePlayer>())
            {
                if (player.playerId == playerId)
                    return player;
            }
            return null;
        }

        // Tick @0x4C1B60 (virtual slot 7)
        public override void Tick()
        {
            Vector3 delta = position - m_lastPosition;
            if (delta.magnitude > 0.001f)
            {
                m_forward = delta.normalized;
            }
            m_lastPosition = position;

            CheckForPickups();
            CheckForHiddenTreePickups();
            ProcessDropPickup();
            TickBuffs();   // inlined in the binary; same null-guarded call
        }

        // TickBuffs @0x4C2A90
        private void TickBuffs()
        {
            if (m_buffs == null)
                return;
            m_buffs.Tick(this);
        }

        // CheckForPickups @0x4C1C40
        private void CheckForPickups()
        {
            Cylinder area = new Cylinder(4.0f, 4.0f);
            foreach (GameCorePickup pickup in GameCore.Instance.AllObjects<GameCorePickup>(position, area))
            {
                Vector3 delta = pickup.position - position;
                // NOTE: binary compares distance (not squared) against range² —
                // faithful to the original.
                if (delta.magnitude < pickup.detectionRange * pickup.detectionRange)
                {
                    pickup.Pickup(this);   // virtual slot 9
                }
            }
        }

        // CheckForHiddenTreePickups @0x4C1FD0
        // Trees can hide currency/fruit pickups; walking near one reveals it.
        private void CheckForHiddenTreePickups()
        {
            Cylinder area = new Cylinder(4.0f, 8.0f);
            if (Q4.StageHub.GetCurrentStage() == null)
                return;

            foreach (GameCoreTree tree in GameCore.Instance.AllObjects<GameCoreTree>(position, area))
            {
                if (tree.hiddenPickupIndex >= 0)
                {
                    Q4.NatureTree treeView =
                        Q4.GameCoreBridge.Instance.GetUnityObject<Q4.NatureTree>(tree.handle);
                    Vector3 delta = tree.position - position;
                    // Structure.playerDetectionRange (+0x20); distance vs range².
                    if (delta.magnitude < treeView.playerDetectionRange * treeView.playerDetectionRange)
                    {
                        Q4.PickupMovement movement = treeView.GetComponent<Q4.PickupMovement>();
                        Q4.PickupManager.HiddenPickupData data;
                        if (tree.hiddenPickupIndex == GameCoreTree.DirectlySetPickupDataIndex) // 2000
                        {
                            // Data lives on a HiddenTreePickup component on the tree view.
                            Q4.HiddenTreePickup hidden = treeView.gameObject.GetComponent<Q4.HiddenTreePickup>();
                            data = hidden != null ? hidden.hiddenPickupData : null;
                        }
                        else
                        {
                            data = Q4.StageHub.GetCurrentStage().pickupManager
                                     .hiddenPickupData[tree.hiddenPickupIndex];
                        }
                        if (data != null)
                        {
                            Q4.StageHub.GetCurrentStage().pickupManager
                                .CreatePickup(data, tree.position, movement);
                            Events.hiddenPickupFoundEvent.Invoke(this, data.type, data.amount);
                        }
                        tree.hiddenPickupIndex = -1;
                    }
                }
            }
        }

        // DropPickup @0x4C2AB0
        // Schedules a loose-currency drop (used when the player is bumped by an
        // enemy): after 'delay' ticks, lose/drop coins and gems scaled by wave.
        public void DropPickup(int delay, int lossCoins, int dropCoins, int lossGems, int dropGems,
                               int valuePerCoin = -1, int valuePerGem = -1)
        {
            m_isPendingLooseCoins = true;
            m_looseCoinsDelay = delay;
            m_lossCoins = lossCoins;
            m_dropCoins = dropCoins;
            m_lossGems = lossGems;
            m_dropGems = dropGems;
            m_valuePerCoin = valuePerCoin;
            m_valuePerGem = valuePerGem;
        }

        // ProcessDropPickup @0x4C2670
        private void ProcessDropPickup()
        {
            if (m_isPendingLooseCoins)
            {
                m_looseCoinsDelay--;
                if (m_looseCoinsDelay == 0)
                {
                    GameCoreInventory inventory = GameCoreInventory.GetInventoryObject();
                    GameCoreWaveManager waveManager = GameCore.Instance.FirstObject<GameCoreWaveManager>();
                    if (inventory != null && waveManager != null)
                    {
                        int multiplier = waveManager.waveCurrentIndex + 1;

                        // Losses are clamped to what the player actually has, and
                        // removed without counting as 'spent'.
                        int coins = inventory.GetAvailableInventory(handle, GameCoreInventory.EInventoryType.Coin);
                        int lossCoins = Mathf.Min(coins, m_lossCoins * multiplier);
                        int gems = inventory.GetAvailableInventory(handle, GameCoreInventory.EInventoryType.Gem);
                        int lossGems = Mathf.Min(gems, m_lossGems);
                        if (lossCoins > 0)
                            inventory.RemoveInventory(handle, GameCoreInventory.EInventoryType.Coin, lossCoins, false);
                        if (lossGems > 0)
                            inventory.RemoveInventory(handle, GameCoreInventory.EInventoryType.Gem, lossGems, false);

                        // Drops are computed from the remaining balance; the Q4
                        // layer spawns the physical pickups from playerBumpedEvent.
                        int dropCoins = Mathf.Min(
                            inventory.GetAvailableInventory(handle, GameCoreInventory.EInventoryType.Coin),
                            m_dropCoins * multiplier);
                        int dropGems = Mathf.Min(
                            inventory.GetAvailableInventory(handle, GameCoreInventory.EInventoryType.Gem),
                            m_dropGems);
                        Events.playerBumpedEvent.Invoke(this,
                            new CurrencyValueInfo(dropCoins, m_valuePerCoin),
                            new CurrencyValueInfo(dropGems, m_valuePerGem));
                    }
                    m_isPendingLooseCoins = false;
                    m_lossCoins = 0;
                    m_dropCoins = 0;
                    m_lossGems = 0;
                    m_dropGems = 0;
                    m_valuePerCoin = 0;
                    m_valuePerGem = 0;
                }
            }
        }

        // OnFruitPickedUp @0x4C2B00 (fruitPickedUpEvent listener)
        private void OnFruitPickedUp(GameCorePlayer a_player, GameCoreFruit a_fruit)
        {
            if (a_player.handle == handle && a_player.m_heldFruitHandle.m_handle < 0)
            {
                GameCorePlayer player = handle.GetMostRecentObjectVersion<GameCorePlayer>();
                if (a_fruit != null && player != null)
                {
                    player.m_heldFruitHandle = a_fruit.handle;
                    GameCoreFruit fruit = a_fruit.handle.GetMostRecentObjectVersion<GameCoreFruit>();
                    if (fruit != null)
                    {
                        // INFERRED accessibility: metadata lists these fields private
                        // with getters only, but the binary writes them directly from
                        // here (@0x4C2Bxx); original source likely used internal fields.
                        fruit.m_playerOwner = player.handle;      // fruit +0xC0
                        fruit.m_lastPlayerOwner = player.handle;  // fruit +0xE0
                    }
                }
            }
        }

        // OnFruitDropped @0x4C2C70 (fruitDroppedEvent listener)
        private void OnFruitDropped(GameCorePlayer a_player, GameCoreFruit a_fruit, Vector3 a_force)
        {
            GameCorePlayer player = handle.GetMostRecentObjectVersion<GameCorePlayer>();
            if (a_player.handle == handle)
            {
                if (a_fruit.handle == player.m_heldFruitHandle)
                {
                    GameCoreFruit heldFruit = player.m_heldFruitHandle.GetMostRecentObjectVersion<GameCoreFruit>();
                    if (heldFruit != null)
                    {
                        heldFruit.OnDrop(player, a_force);
                        player.m_heldFruitHandle = GameCoreHandle.nullHandle;
                    }
                }
            }
        }

        // RecreateViewer @0x4C2E80 (virtual slot 5)
        public override GameObject RecreateViewer()
        {
            Q4.Player view = GetUnityObject<Q4.Player>();
            if (view == null)
            {
                foreach (Q4.Player candidate in Object.FindObjectsOfType<Q4.Player>())
                {
                    if (candidate.playerID == playerId)
                    {
                        view = candidate;
                        break;
                    }
                }
            }
            if (view != null)
            {
                view.transform.position = position;
            }
            else
            {
                Debug.LogError(string.Format(
                    "Could not find a player id={0} for sync, loading into multiplayer games is not currently supported.",
                    playerId));
            }
            return view.gameObject;
        }

        // DestroySelf @0x4C30B0 (virtual slot 6)
        public override void DestroySelf()
        {
            base.DestroySelf();
            Events.fruitPickedUpEvent.RemoveListener(OnFruitPickedUp);
            Events.fruitDroppedEvent.RemoveListener(OnFruitDropped);
            Events.playerRemovedEvent.Invoke(this);
        }
    }
}
