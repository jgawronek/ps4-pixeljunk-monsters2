// GameCore/GameCoreInventory.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Logic: GameCore.GameCoreInventory methods @0x4BD1E0..0x4BEAF0 and nested
// InventoryBag @0x4BD8C0..0x4BE160. Nested types (EInventoryType, InventoryBag)
// confirmed from dump.cs TypeDefIndex 3044/3045.
//
// Per-player currency wallets. playerInventory maps playerId → bag; clientInventory
// is the shared/predicted copy: in single-player (non-network match) ALL players
// share the bag stored under key 0, while playerInventory keeps per-player
// references to it. Wave end grants interest coins (waveClearCoinRate).

using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace GameCore
{
    public class GameCoreInventory : GameCoreObject
    {
        [CoreObjectPool.DeepCopyAttribute]
        private Dictionary<int, InventoryBag> playerInventory = new Dictionary<int, InventoryBag>(); // 0x60
        [CoreObjectPool.DeepCopyAttribute]
        private Dictionary<int, InventoryBag> clientInventory = new Dictionary<int, InventoryBag>(); // 0x68
        private float waveClearCoinRate = 1.0f;   // 0x70 (pre-base initializer)

        // .ctor @0x4BD1E0 (private)
        private GameCoreInventory()
            : base()
        {
            // Wave interest is applied after the sim tick (EventTime 1).
            Events.waveEndedEvent.AddListener(OnWaveEnded, Event.EventTime.PostGameCoreTick);
        }

        // GetInventoryObject @0x4BD300
        // Lazily creates the singleton inventory (registered with the current
        // frame by the GameCoreObject ctor) and seeds bags for existing players.
        public static GameCoreInventory GetInventoryObject()
        {
            GameCoreInventory inventory = GameCore.Instance.FirstObject<GameCoreInventory>();
            if (inventory == null)
            {
                Debug.Log("Creating GameCoreInventory object. Please verify we are in a game core safe context.");
                inventory = new GameCoreInventory();

                float rate = 0.0f;
                if (Q4.StageMain.CurrentStage != null)
                    rate = Q4.StageMain.CurrentStage.initWaveCoinRate;
                inventory.waveClearCoinRate = rate;

                foreach (GameCorePlayer player in GameCore.Instance.AllObjects<GameCorePlayer>())
                {
                    inventory.GetBagForPlayer(player.playerId);
                }
            }
            return inventory.handle.GetMostRecentObjectVersion<GameCoreInventory>();
        }

        // GetBagForPlayer @0x4BD6C0
        private InventoryBag GetBagForPlayer(int playerId)
        {
            InventoryBag bag;
            if (!playerInventory.TryGetValue(playerId, out bag))
            {
                // Network match: per-player client bag. Single-player: everyone
                // shares the bag under key 0.
                int clientKey = Q4.Networking.NetworkMatch.IsNetworkMatch ? playerId : 0;
                if (!clientInventory.TryGetValue(clientKey, out bag))
                {
                    bag = new InventoryBag();
                    if (Q4.StageMain.CurrentStage != null)
                    {
                        bag.SetValue(EInventoryType.Coin, Q4.StageMain.CurrentStage.initCoin);
                        bag.SetValue(EInventoryType.Gem, Q4.StageMain.CurrentStage.initGem);
                    }
                    clientInventory[clientKey] = bag;
                }
                playerInventory[playerId] = bag;
            }
            return bag;
        }

        // DestroySelf @0x4BD9E0 (virtual slot 6)
        public override void DestroySelf()
        {
            base.DestroySelf();
            Events.waveEndedEvent.RemoveListener(OnWaveEnded);
        }

        // OnWaveEnded @0x4BDAD0
        // Interest: round(coins * waveClearCoinRate) - coins, granted as both
        // Coin and InterestCoins. Shared bags are processed once (HashSet dedup).
        public void OnWaveEnded(GameCoreWaveManager manager, int waveIndex)
        {
            HashSet<InventoryBag> processed = new HashSet<InventoryBag>();
            foreach (KeyValuePair<int, InventoryBag> entry in playerInventory)
            {
                if (processed.Add(entry.Value))
                {
                    GameCorePlayer player = GameCorePlayer.GetPlayer(entry.Key);
                    if (player != null)
                    {
                        int coins = entry.Value.GetValue(EInventoryType.Coin);
                        int newCoins = Mathf.RoundToInt(coins * waveClearCoinRate);
                        int interest = newCoins - coins;
                        if (interest != 0 && coins <= newCoins)
                        {
                            GameCoreInventory inventory = handle.GetMostRecentObjectVersion<GameCoreInventory>();
                            inventory.AddInventory(player.handle, EInventoryType.Coin, interest);
                            inventory.AddInventory(player.handle, EInventoryType.InterestCoins, interest);
                        }
                    }
                }
            }
        }

        // AddInventory @0x4BE160
        public void AddInventory(GameCoreHandle player, EInventoryType type, int amount)
        {
            GameCorePlayer playerObject = player.GetMostRecentObjectVersion<GameCorePlayer>();
            if (playerObject == null)
                return;
            InventoryBag bag = GetBagForPlayer(playerObject.playerId);
            int current = bag.GetValue(type);
            Network.NetworkLog.Instance.Log(
                string.Format("Adding inventory {0}", type), current + amount, true);
            bag.SetValue(type, current + amount);
            Events.onAddInventory.Invoke(playerObject, this, type, amount);
        }

        // RemoveInventory @0x4BE460
        // Clamps at 0; 'spent' additionally accumulates SpentCoins/SpentGems stats.
        public void RemoveInventory(GameCoreHandle player, EInventoryType type, int amount, bool spent = true)
        {
            GameCorePlayer playerObject = player.GetMostRecentObjectVersion<GameCorePlayer>();
            if (playerObject == null)
                return;
            InventoryBag bag = GetBagForPlayer(playerObject.playerId);
            int current = bag.GetValue(type);
            int newValue = Mathf.Max(0, current - amount);
            Network.NetworkLog.Instance.Log(
                string.Format("Removing inventory {0}", type), newValue, true);
            bag.SetValue(type, newValue);
            Events.onRemoveInventory.Invoke(playerObject, this, type, amount);
            if (spent)
            {
                EInventoryType spentType = type == EInventoryType.Coin
                    ? EInventoryType.SpentCoins    // 4 - (type == Coin ? 1 : 0)
                    : EInventoryType.SpentGems;
                bag.SetValue(spentType, bag.GetValue(spentType) + amount);
            }
        }

        // HasInventory @0x4BE680
        public bool HasInventory(GameCoreHandle player, EInventoryType type, int amount)
        {
            GameCorePlayer playerObject = player.GetMostRecentObjectVersion<GameCorePlayer>();
            if (playerObject == null)
                return false;
            return amount <= GetBagForPlayer(playerObject.playerId).GetValue(type);
        }

        // GetAvailableInventory @0x4BE740
        public int GetAvailableInventory(GameCoreHandle player, EInventoryType type)
        {
            GameCorePlayer playerObject = player.GetMostRecentObjectVersion<GameCorePlayer>();
            if (playerObject == null)
                return 0;
            return GetBagForPlayer(playerObject.playerId).GetValue(type);
        }

        // GetEndOfGameStatistics @0x4BE7C0 (totals across distinct bags)
        // coins = Coin - InterestCoins + SpentCoins (earned coins, incl. spent),
        // gems  = Gem + SpentGems.
        public void GetEndOfGameStatistics(out int totalCoinsAcquired, out int totalGemsAcquired,
                                           out int totalInterestCoinsAcquired)
        {
            totalCoinsAcquired = 0;
            totalGemsAcquired = 0;
            totalInterestCoinsAcquired = 0;
            HashSet<InventoryBag> processed = new HashSet<InventoryBag>();
            foreach (KeyValuePair<int, InventoryBag> entry in playerInventory)
            {
                if (processed.Add(entry.Value))
                {
                    InventoryBag bag = GetBagForPlayer(entry.Key);
                    int interest = bag.GetValue(EInventoryType.InterestCoins);
                    int coins = bag.GetValue(EInventoryType.Coin) - interest
                              + bag.GetValue(EInventoryType.SpentCoins);
                    int gems = bag.GetValue(EInventoryType.Gem) + bag.GetValue(EInventoryType.SpentGems);
                    totalCoinsAcquired += coins;
                    totalGemsAcquired += gems;
                    totalInterestCoinsAcquired += interest;
                }
            }
        }

        // GetEndOfGameStatistics @0x4BEA80 (per-player overload)
        public void GetEndOfGameStatistics(int playerId, out int coinsAcquired, out int gemsAcquired,
                                           out int interestCoinsAcquired)
        {
            InventoryBag bag = GetBagForPlayer(playerId);
            interestCoinsAcquired = bag.GetValue(EInventoryType.InterestCoins);
            coinsAcquired = bag.GetValue(EInventoryType.Coin)
                          + bag.GetValue(EInventoryType.SpentCoins) - interestCoinsAcquired;
            gemsAcquired = bag.GetValue(EInventoryType.Gem) + bag.GetValue(EInventoryType.SpentGems);
        }

        // ---- Nested types (confirmed from dump.cs) ----

        // TypeDefIndex 3044
        public enum EInventoryType
        {
            Coin = 0,
            Gem = 1,
            InterestCoins = 2,
            SpentCoins = 3,
            SpentGems = 4,
        }

        // TypeDefIndex 3045. Lazy int[] sized to the largest enum value + 1.
        [Serializable]
        private class InventoryBag
        {
            private int[] values;   // 0x10 (null until first SetValue)

            // .ctor @0x4BD8C0 — default ctor, values stays null.
            public InventoryBag()
            {
            }

            // SetValue @0x4BD8D0
            public void SetValue(EInventoryType type, int value)
            {
                if (values == null)
                {
                    int max = Enum.GetValues(typeof(EInventoryType)).Cast<int>().Max();
                    values = new int[max + 1];
                }
                values[(int)type] = value;
            }

            // GetValue @0x4BE140
            public int GetValue(EInventoryType type)
            {
                if (values == null)
                    return 0;
                return values[(int)type];
            }
        }
    }
}
