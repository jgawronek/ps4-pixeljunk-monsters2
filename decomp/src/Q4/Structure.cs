// Q4/Structure.cs
// Reconstructed from IL2CPP decompilation (Il2CppUserAssemblies.elf) + metadata v23.
// Original: PixelJunk Monsters 2 (PS4, CUSA11967), Unity 5.6.5p1.
//
// THE BASE VIEW CLASS for placed structures: Home, TowerBase and NatureTree all
// derive from Structure (the task's "GameCoreViewBase/ViewObject/PlaceableViewObject"
// hint names do not exist in the metadata — Structure is the real shared base).
// It provides:
//   * the player-proximity trigger (DelegateTrigger sphere) that feeds the
//     player's PlayerStructureSelector (build/interact selection),
//   * tower-range UI events (UnityEvents.playerEnterTowerRangeEvent /
//     playerExitTowerRangeEvent, invoked with `this as TowerBase`),
//   * stage-cleared / game-over handling (deactivate on either),
//   * selection highlight + activation hooks overridden by subclasses.
// The sim-side counterpart is created by the subclass's IPlaceableViewObject
// implementation; Structure itself holds no GameCore handle.
//
// Field offsets / virtual slots from skeleton/Q4.cs (TypeDefIndex 3387).

using GameCore;
using GameCore.Event;
using UnityEngine;

namespace Q4
{
    public class Structure : MonoBehaviour
    {
        [HideInInspector] public uint structureUID;          // 0x18
        [HideInInspector] public float enemyDetectionRange;  // 0x1C
        [HideInInspector] public float playerDetectionRange; // 0x20
        protected DelegateTrigger m_triggerToPlayer;         // 0x28
        protected Transform m_transform;                     // 0x30
        protected bool m_structureActive;                    // 0x38

        public virtual bool canInteract
        {
            get { return true; }                             // get_canInteract @0x535790 (Slot 4)
        }

        // .ctor @0x535770
        public Structure()
        {
            enemyDetectionRange = 2.5f;                      // 0x40200000
            playerDetectionRange = 1.0f;                     // 0x3F800000
            m_structureActive = true;
        }

        // Start @0x5357A0 (Slot 5)
        protected virtual void Start()
        {
            m_transform = transform;
            InitTriggers();
            // Both callbacks deferred to LateUpdate (EventTime.PostUnityUpdate = 2).
            Events.stageClearedEvent.AddListener(OnStageCleared, EventTime.PostUnityUpdate);
            Events.gameOverEvent.AddListener(OnGameOver, EventTime.PostUnityUpdate);
        }

        // InitTransform @0x5358E0
        private void InitTransform()
        {
            m_transform = transform;
        }

        // InitTriggers @0x535900
        protected void InitTriggers()
        {
            m_triggerToPlayer = DelegateTrigger.CreateDelegateTriggerObject(
                gameObject, "PlayerTrigger", "TriggerToPlayer", playerDetectionRange);
            m_triggerToPlayer.onTriggerEnterDelegate = OnPlayerEnter;   // virtual Slot 15
            m_triggerToPlayer.onTriggerStayDelegate = OnPlayerStay;     // virtual Slot 16
            m_triggerToPlayer.onTriggerExitDelegate = OnPlayerExit;     // virtual Slot 17
        }

        // SetSelected @0x535A20 (Slot 6)
        public virtual void SetSelected(bool selected)
        {
            // INFERRED component type: decompiler shows a shared-generic
            // GetComponent<DelegateUpdates>; the result's Color field at +0x18
            // matches SkinnedMeshOutlineSetting (confirmed GetComponent
            // instantiation) — the selection outline. TODO: confirm.
            SkinnedMeshOutlineSetting outline = GetComponent<SkinnedMeshOutlineSetting>();
            Color color = (outline != null) ? outline.color : Color.yellow;
            SetSelected(selected, color);
        }

        // SetSelected @0x535AF0 (Slot 7) — base is a no-op.
        public virtual void SetSelected(bool selected, Color color)
        {
        }

        // SetRadius @0x535B00 (Slot 8) — base is a no-op.
        public virtual void SetRadius(float radius)
        {
        }

        // OnStageCleared @0x535B10
        public void OnStageCleared(GameCoreWaveManager manager)
        {
            SetStructureActive(false);
        }

        // OnGameOver @0x535B30
        public void OnGameOver()
        {
            SetStructureActive(false);
        }

        // SetStructureActive @0x535B50 (Slot 9)
        public virtual void SetStructureActive(bool active)
        {
            m_structureActive = active;
        }

        // IsStructureActive @0x535B60
        public bool IsStructureActive()
        {
            return m_structureActive;
        }

        // SetStructureEnabled @0x535B70 (Slot 10)
        public virtual void SetStructureEnabled(bool enable)
        {
            gameObject.SetActive(enable);
        }

        // OnInteraction @0x535BA0 (Slot 11) — base is a no-op.
        public virtual void OnInteraction(Player player)
        {
        }

        // OnEnemyEnter @0x535BB0 (Slot 12) — base is a no-op.
        public virtual void OnEnemyEnter(Collider other)
        {
        }

        // OnEnemyStay @0x535BC0 (Slot 13) — base is a no-op.
        public virtual void OnEnemyStay(Collider other)
        {
        }

        // OnEnemyExit @0x535BD0 (Slot 14) — base is a no-op.
        public virtual void OnEnemyExit(Collider other)
        {
        }

        // OnPlayerEnter @0x535BE0 (Slot 15)
        public virtual void OnPlayerEnter(Collider other)
        {
            if (other == null)
                return;
            Player player = other.GetComponent<Player>();
            if (player == null)
                return;
            if (player.StructureSelector == null)
                return;

            player.StructureSelector.AddSelection(this);
            // UI: only towers raise the range event (null for other structures).
            UnityEvents.playerEnterTowerRangeEvent.Invoke(this as TowerBase);
        }

        // OnPlayerStay @0x535D90 (Slot 16) — base is a no-op.
        public virtual void OnPlayerStay(Collider other)
        {
        }

        // OnPlayerExit @0x535DA0 (Slot 17)
        public virtual void OnPlayerExit(Collider other)
        {
            if (other == null)
                return;
            RemoveFromPlayerSelection(other.GetComponent<Player>());
            UnityEvents.playerExitTowerRangeEvent.Invoke(this as TowerBase);
        }

        // RemoveFromPlayerSelection @0x535EC0
        public void RemoveFromPlayerSelection(Player player)
        {
            if (player == null)
                return;
            if (player.StructureSelector == null)
                return;
            player.StructureSelector.RemoveSelection(this);
        }
    }
}